import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import authoredConfig from "../data/visits.ts";
import { fold } from "../src/map/text.ts";
import { dateBounds } from "../src/map/time.ts";
import { cachePath, commitVisits } from "./add.ts";
import {
  csvFromVisits,
  duplicateOf,
  overlapsExisting,
  parseCsv,
  visitsFromRows,
  type AuthoredVisit,
} from "./authoring.ts";
import {
  clusterPhotos,
  defaultClusterOptions,
  groupTrips,
  type ClusterOptions,
  type Home,
  type ProposedVisit,
} from "./clusters.ts";
import { buildQuery, cacheSchema, queryKey } from "./config.ts";
import { osxphotosFields, readOsxphotos } from "./photo-sources.ts";

/**
 * `npm run photos`: proposes visits from a photo library export, shows them,
 * and after a yes hands them to the same code path as `npm run add`. The export
 * stays where it is; only country, city and dates reach the repository.
 */
const settingsPath = fileURLToPath(new URL("../data/photos.json", import.meta.url));
const rejectedSchema = z.strictObject({
  country: z.string(),
  city: z.string(),
  start: z.string(),
  end: z.string(),
});
const settingsSchema = z.strictObject({
  homeRadiusKm: z.number().positive().optional(),
  minPhotos: z.number().int().positive().optional(),
  minSpanMinutes: z.number().int().nonnegative().optional(),
  dayTripMinPhotos: z.number().int().positive().optional(),
  maxGapDays: z.number().int().nonnegative().optional(),
  /** Newest photo date the last run saw; the next run starts a week before it. */
  lastDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Proposals turned down, so they are not offered again. */
  rejected: z.array(rejectedSchema).default([]),
});
export type PhotoSettings = z.infer<typeof settingsSchema>;

const help = `Propose visits from photos and add the ones you confirm.

Usage: npm run photos -- <export> [--dry-run] [--yes] [--no-geocode] [--since DATE | --all]
                                  [--home-radius KM] [--min-photos N] [--day-trip-photos N] [--max-gap-days N]

<export> is what osxphotos (https://github.com/RhetTbull/osxphotos) writes with the
fields below, as JSON or CSV. Install it once with: uv tool install osxphotos

  osxphotos query --person "Name" --location --json \\
${osxphotosFields.map(([name, template]) => `    --field ${name} '${template}'`).join(" \\\n")} \\
    > photos.json

Photos collapse to city-days using the place Photos attached; days at home and days
with too few photos are dropped; runs of days become stays and lone days day trips.
The proposal is printed first and nothing is written until you answer Y, or you
pass --yes. "edit" opens the proposal as a CSV in $EDITOR and imports what you save.
"n" remembers the proposals in data/photos.json so they are not offered again.
Settings and the date floor of the last run live in data/photos.json; flags override.
`;

type Flags = {
  dryRun: boolean;
  yes: boolean;
  geocode: boolean;
  since?: string;
  all: boolean;
  overrides: Partial<ClusterOptions>;
};
function parseFlags(argv: readonly string[]): { file?: string; flags: Flags; help: boolean } {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "no-geocode": { type: "boolean", default: false },
      since: { type: "string" },
      all: { type: "boolean", default: false },
      "home-radius": { type: "string" },
      "min-photos": { type: "string" },
      "day-trip-photos": { type: "string" },
      "max-gap-days": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const numberFlag = (name: "home-radius" | "min-photos" | "day-trip-photos" | "max-gap-days"): number | undefined => {
    const raw = values[name];
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} needs a non-negative number, not "${raw}"`);
    return parsed;
  };
  if (values.since && !/^\d{4}-\d{2}-\d{2}$/.test(values.since))
    throw new Error(`--since needs a YYYY-MM-DD date, not "${values.since}"`);
  const overrides: Partial<ClusterOptions> = {};
  const radius = numberFlag("home-radius");
  const minPhotos = numberFlag("min-photos");
  const dayTrip = numberFlag("day-trip-photos");
  const gap = numberFlag("max-gap-days");
  if (radius !== undefined) overrides.homeRadiusKm = radius;
  if (minPhotos !== undefined) overrides.minPhotos = minPhotos;
  if (dayTrip !== undefined) overrides.dayTripMinPhotos = dayTrip;
  if (gap !== undefined) overrides.maxGapDays = gap;
  return {
    file: positionals[0],
    help: values.help,
    flags: {
      dryRun: values["dry-run"],
      yes: values.yes,
      geocode: !values["no-geocode"],
      since: values.since,
      all: values.all,
      overrides,
    },
  };
}

async function readSettings(): Promise<PhotoSettings> {
  try {
    return settingsSchema.parse(JSON.parse(await readFile(settingsPath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { rejected: [] };
    throw error;
  }
}
async function writeSettings(settings: PhotoSettings): Promise<void> {
  const ordered: PhotoSettings = {
    ...(settings.homeRadiusKm !== undefined ? { homeRadiusKm: settings.homeRadiusKm } : {}),
    ...(settings.minPhotos !== undefined ? { minPhotos: settings.minPhotos } : {}),
    ...(settings.minSpanMinutes !== undefined ? { minSpanMinutes: settings.minSpanMinutes } : {}),
    ...(settings.dayTripMinPhotos !== undefined ? { dayTripMinPhotos: settings.dayTripMinPhotos } : {}),
    ...(settings.maxGapDays !== undefined ? { maxGapDays: settings.maxGapDays } : {}),
    ...(settings.lastDate ? { lastDate: settings.lastDate } : {}),
    rejected: [...settings.rejected].sort(
      (a, b) => a.start.localeCompare(b.start) || a.country.localeCompare(b.country) || a.city.localeCompare(b.city),
    ),
  };
  await writeFile(settingsPath, `${JSON.stringify(ordered, null, 2)}\n`);
}

/** Every home the config lists, with its cached city point when the geocache has one. */
export async function homesFromConfig(): Promise<Home[]> {
  const homes = authoredConfig.home === undefined ? [] : [authoredConfig.home].flat();
  let cache: z.infer<typeof cacheSchema> = {};
  try {
    cache = cacheSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return homes.map((home) => {
    const entry = cache[queryKey(buildQuery(home, "city"))];
    return { country: home.country, city: home.city, ...(entry ? { coordinates: entry.coordinates } : {}) };
  });
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const when = (visit: AuthoredVisit): string => {
  const [start, end] = dateBounds(visit);
  return start === end ? start : `${start} .. ${end}`;
};
const rejectionKey = (visit: AuthoredVisit): string => {
  const [start, end] = dateBounds(visit);
  return `${visit.country}|${fold(visit.city)}|${start}|${end}`;
};
const toRejection = (visit: AuthoredVisit): PhotoSettings["rejected"][number] => {
  const [start, end] = dateBounds(visit);
  return { country: visit.country, city: visit.city, start, end };
};
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

type Review = { visit: ProposedVisit; status: "new" | "present" | "rejected" };
function review(visits: readonly ProposedVisit[], settings: PhotoSettings): Review[] {
  const rejected = new Set(settings.rejected.map((entry) => `${entry.country}|${fold(entry.city)}|${entry.start}|${entry.end}`));
  return visits.map((visit) => ({
    visit,
    status: rejected.has(rejectionKey(visit))
      ? "rejected"
      : duplicateOf(authoredConfig, visit) || overlapsExisting(authoredConfig, visit)
        ? "present"
        : "new",
  }));
}

/** The proposal as the user reads it: trips of touching dates, numbered rows under each. */
export function renderProposal(reviews: readonly Review[], extras: { passedThrough: number; home: number; unnamed: number }): string {
  const lines: string[] = [];
  let next = 1;
  const city = (visit: ProposedVisit) => `${visit.city}, ${visit.country}`;
  const width = Math.max(12, ...reviews.map((entry) => city(entry.visit).length));
  for (const group of groupTrips(reviews.map((entry) => entry.visit))) {
    const single = group.visits.length === 1;
    if (!single) lines.push(`Trip ${group.start} .. ${group.end}`);
    for (const visit of group.visits) {
      const entry = reviews.find((candidate) => candidate.visit === visit)!;
      const tag = entry.status === "new" ? String(next++).padStart(3) : "   ";
      const kind = visit.dayTrip ? "day trip" : visit.date ? "day" : "stay";
      const note =
        entry.status === "present" ? "already in the atlas" : entry.status === "rejected" ? "turned down before" : "";
      const album = visit.album && entry.status === "new" ? `album "${visit.album}"` : "";
      lines.push(
        `${tag}  ${city(visit).padEnd(width)}  ${when(visit).padEnd(24)}  ${kind.padEnd(8)}  ${plural(visit.photos, "photo").padStart(11)}  ${[note, album].filter(Boolean).join("; ")}`.trimEnd(),
      );
    }
  }
  const footer = [
    extras.passedThrough ? `${plural(extras.passedThrough, "place")} passed through (too few photos or too short a stop)` : "",
    extras.home ? `${plural(extras.home, "photo")} at home` : "",
    extras.unnamed ? `${plural(extras.unnamed, "photo")} without a place name` : "",
  ].filter(Boolean);
  if (footer.length) lines.push("", `Skipped: ${footer.join("; ")}.`);
  return lines.join("\n");
}

async function editInEditor(visits: readonly AuthoredVisit[]): Promise<AuthoredVisit[]> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const dir = await mkdtemp(join(tmpdir(), "atlas-photos-"));
  const file = join(dir, "proposal.csv");
  try {
    await writeFile(file, csvFromVisits(visits));
    const result = spawnSync(editor, [file], { stdio: "inherit", shell: process.platform === "win32" });
    if (result.status !== 0) throw new Error(`${editor} exited with status ${result.status ?? "unknown"}; nothing imported`);
    const { accepted, skipped, failed } = visitsFromRows(parseCsv(await readFile(file, "utf8")), authoredConfig);
    for (const line of skipped) console.log(`skip  ${line}`);
    if (failed.length) throw new Error(`${failed.join("\n")}\n${plural(failed.length, "invalid row")}; nothing written.`);
    return accepted;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const parsed = parseFlags(process.argv.slice(2));
  if (parsed.help || !parsed.file) {
    console.log(help);
    process.exitCode = parsed.help ? 0 : 1;
    return;
  }
  const { flags } = parsed;
  const settings = await readSettings();
  const options: ClusterOptions = {
    ...defaultClusterOptions,
    ...(settings.homeRadiusKm !== undefined ? { homeRadiusKm: settings.homeRadiusKm } : {}),
    ...(settings.minPhotos !== undefined ? { minPhotos: settings.minPhotos } : {}),
    ...(settings.minSpanMinutes !== undefined ? { minSpanMinutes: settings.minSpanMinutes } : {}),
    ...(settings.dayTripMinPhotos !== undefined ? { dayTripMinPhotos: settings.dayTripMinPhotos } : {}),
    ...(settings.maxGapDays !== undefined ? { maxGapDays: settings.maxGapDays } : {}),
    ...flags.overrides,
    homes: await homesFromConfig(),
    // Stays the atlas already holds are bases: a run of days beside one is day trips.
    knownStays: authoredConfig.visits.flatMap((visit) =>
      visit.city && visit.dateRange && visit.dateRange[0] && visit.dateRange[1]
        ? [{ country: visit.country, city: visit.city, start: visit.dateRange[0], end: visit.dateRange[1] }]
        : [],
    ),
  };
  const all = readOsxphotos(await readFile(parsed.file, "utf8"));
  // Incremental by default: a week before the newest photo of the last run, so a
  // stay that was under way then is seen whole; overlaps with the atlas are skipped.
  const floor = flags.all ? undefined : (flags.since ?? (settings.lastDate ? addDays(settings.lastDate, -7) : undefined));
  const photos = floor ? all.filter((photo) => photo.date >= floor) : all;
  const result = clusterPhotos(photos, options);
  const reviews = review(result.visits, settings);
  const fresh = reviews.filter((entry) => entry.status === "new").map((entry) => entry.visit);
  const homeNote = options.homes?.length
    ? `home ${options.homes.map((home) => home.city).join(", ")} within ${options.homeRadiusKm} km`
    : "no home set";
  console.log(
    `${plural(photos.length, "located photo")}${floor ? ` since ${floor}` : ""}${all.length !== photos.length ? ` of ${all.length}` : ""}; ${homeNote}; a day counts from ${options.minPhotos} photos or ${options.minSpanMinutes} minutes, a day trip from ${options.dayTripMinPhotos} photos over ${options.minSpanMinutes} minutes, twice that on a travel day.`,
  );
  if (photos.length && !photos.some((photo) => photo.time))
    console.log(
      "The export carries no photo times, so short stops cannot be told from day trips; add --field time '{created.strftime,%H:%M}' to the osxphotos command.",
    );
  if (!result.visits.length) {
    console.log("No visits to propose.");
    console.log(renderProposal([], { passedThrough: result.passedThrough.length, ...result.dropped }));
    return;
  }
  console.log("");
  console.log(renderProposal(reviews, { passedThrough: result.passedThrough.length, ...result.dropped }));
  console.log("");
  if (!fresh.length) {
    console.log("Nothing new to add.");
    return;
  }
  let accepted: AuthoredVisit[] = fresh.map(({ photos: _photos, album: _album, point: _point, ...visit }) => visit);
  let answer = flags.yes || flags.dryRun ? "y" : "";
  if (!answer) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      answer = (await rl.question(`Add ${fresh.length === 1 ? "it" : `all ${fresh.length}`}? [Y/n/edit] `)).trim().toLowerCase() || "y";
    } finally {
      rl.close();
    }
  }
  if (answer === "n" || answer === "no") {
    settings.rejected.push(...accepted.map(toRejection));
    await writeSettings(settings);
    console.log(`Noted; ${plural(accepted.length, "proposal")} will not be offered again. Edit data/photos.json to change your mind.`);
    return;
  }
  if (answer === "e" || answer === "edit") {
    const kept = await editInEditor(accepted);
    const keptKeys = new Set(kept.map(rejectionKey));
    settings.rejected.push(...accepted.filter((visit) => !keptKeys.has(rejectionKey(visit))).map(toRejection));
    accepted = kept;
  } else if (answer !== "y" && answer !== "yes") {
    console.log("Nothing written.");
    return;
  }
  if (!accepted.length) {
    console.log("Nothing left to add.");
    await writeSettings(settings);
    return;
  }
  await commitVisits(accepted, { dryRun: flags.dryRun, geocode: flags.geocode });
  if (!flags.dryRun) {
    if (result.lastDate && (!settings.lastDate || result.lastDate > settings.lastDate)) settings.lastDate = result.lastDate;
    await writeSettings(settings);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
