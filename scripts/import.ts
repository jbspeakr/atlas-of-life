import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import authoredConfig from "../data/visits.ts";
import { duplicateOf, parseCsv, visitFromRow, type AuthoredVisit } from "./authoring.ts";
import { commitVisits } from "./add.ts";

const help = `Import visits from a CSV with the header country,city,start,end,label,trip[,region][,daytrip].

Usage: npm run import -- <file.csv> [--dry-run] [--no-geocode]

Each row goes through the same validation as npm run add. Duplicates of existing
or earlier rows are skipped; invalid rows are reported with their line number and
abort the import before anything is written. GPX or timeline exports need reverse
geocoding against Nominatim's usage policy and are deliberately not supported here.
`;
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-geocode": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help || positionals.length !== 1) {
  console.log(help);
  process.exitCode = values.help ? 0 : 1;
} else {
  const rows = parseCsv(await readFile(positionals[0], "utf8"));
  const accepted: AuthoredVisit[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const config = { ...authoredConfig, visits: [...authoredConfig.visits] };
  for (const row of rows) {
    try {
      const visit = visitFromRow(row);
      const existing = duplicateOf(config, visit);
      if (existing) {
        skipped.push(`line ${row.line}: ${visit.city}, ${visit.country} already present`);
        continue;
      }
      accepted.push(visit);
      config.visits.push(visit);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const line of skipped) console.log(`skip  ${line}`);
  for (const line of failed) console.error(`error ${line}`);
  if (failed.length) {
    console.error(`${failed.length} invalid ${failed.length === 1 ? "row" : "rows"}; nothing written.`);
    process.exitCode = 1;
  } else if (!accepted.length) console.log("Nothing new to import.");
  else
    await commitVisits(accepted, { dryRun: values["dry-run"], geocode: !values["no-geocode"] }).catch(
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      },
    );
}
