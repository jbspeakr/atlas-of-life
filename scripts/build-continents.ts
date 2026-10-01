import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root } from "./boundaries.ts";
import { countryCodes } from "./config.ts";

/**
 * Writes data/continents.json: the continent of every country code the schema
 * accepts, from Natural Earth's CONTINENT field, and the list of states that
 * count toward "of 195 countries". Reads the pinned Natural Earth file from
 * the boundary cache, so run `npm run generate` once (not in fixture mode)
 * before `npm run continents`. Output is committed; builds never download for it.
 */
type Source = { url: string; sha256: string; cache: string; version: string };
type Feature = {
  properties: Record<string, unknown>;
};
// Natural Earth files "Seven seas (open ocean)" for ocean states and territories;
// these follow the UN M49 geoscheme instead. Codes absent from Natural Earth
// (territories drawn inside their parent) are placed by the same scheme.
const placed: Record<string, string> = {
  MU: "Africa",
  SC: "Africa",
  SH: "Africa",
  IO: "Africa",
  TF: "Africa",
  RE: "Africa",
  YT: "Africa",
  MV: "Asia",
  GS: "South America",
  BV: "South America",
  GF: "South America",
  HM: "Oceania",
  CC: "Oceania",
  CX: "Oceania",
  TK: "Oceania",
  BQ: "North America",
  GP: "North America",
  MQ: "North America",
  SJ: "Europe",
};
// The 193 United Nations member states and the two observer states (VA, PS):
// the denominator travellers compare themselves against.
const states =
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW VA PS".split(
    " ",
  );

async function main(): Promise<void> {
  const sources = JSON.parse(
    await readFile(resolve(root, "data/sources.json"), "utf8"),
  ) as { naturalEarthCountries: Source };
  const source = sources.naturalEarthCountries;
  const bytes = await readFile(resolve(root, source.cache));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== source.sha256)
    throw new Error(`Natural Earth SHA256 mismatch: ${source.cache}`);
  const data = JSON.parse(bytes.toString("utf8")) as { features: Feature[] };
  const continents: Record<string, string> = {};
  for (const code of countryCodes) {
    if (placed[code]) {
      continents[code] = placed[code];
      continue;
    }
    const features = data.features.filter(
      (feature) => feature.properties.ISO_A2_EH === code,
    );
    // The primary unit carries the continent; a dependency drawn with its
    // parent (Clipperton with France) does not move the parent.
    const primary =
      features.find(
        (feature) => feature.properties.ADM0_A3 === feature.properties.ISO_A3_EH,
      ) ?? features[0];
    const continent = primary?.properties.CONTINENT;
    if (typeof continent !== "string" || continent.startsWith("Seven seas"))
      throw new Error(`No continent for ${code}; add it to the placed table`);
    continents[code] = continent;
  }
  for (const code of states)
    if (!continents[code]) throw new Error(`State ${code} is not an accepted country code`);
  if (new Set(states).size !== 195)
    throw new Error(`Expected 195 states, found ${new Set(states).size}`);
  const output = {
    source: `Natural Earth ${source.version} CONTINENT; UN M49 for ocean states and territories; UN member and observer states`,
    continents: Object.fromEntries(
      Object.entries(continents).sort(([a], [b]) => a.localeCompare(b)),
    ),
    states: [...states].sort(),
  };
  await writeFile(
    resolve(root, "data/continents.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  const tally = new Map<string, number>();
  for (const continent of Object.values(continents))
    tally.set(continent, (tally.get(continent) ?? 0) + 1);
  console.log(
    `Wrote data/continents.json: ${Object.keys(continents).length} codes, ${states.length} states, ${[...tally].map(([name, count]) => `${name} ${count}`).join(", ")}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
