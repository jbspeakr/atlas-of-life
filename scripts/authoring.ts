import { parseArgs } from "node:util";
import ts from "typescript";
import { fold } from "../src/map/text.ts";
import { dateBounds } from "../src/map/time.ts";
import { visitSchema, type Config } from "./config.ts";
/** Validates and reports issues as one readable line instead of a Zod dump. */
function validate(visit: AuthoredVisit, where: string): void {
  const result = visitSchema.safeParse(visit);
  if (result.success) return;
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "visit"}: ${issue.message}`)
    .join("; ");
  throw new Error(`${where}${issues}`);
}

export type AuthoredVisit = {
  country: string;
  city: string;
  region?: string;
  label?: string;
  trip?: string;
  dayTrip?: true;
  via?: true;
  date?: string;
  dateRange?: [string, string];
};
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** `2024-04-25` or `2025-04-04..2025-04-06` (either end may be empty for an open range). */
export function parseDates(text: string): Pick<AuthoredVisit, "date" | "dateRange"> {
  if (isoDate.test(text)) return { date: text };
  const range = text.split("..");
  if (range.length === 2 && range.every((end) => end === "" || isoDate.test(end)))
    return { dateRange: [range[0], range[1]] };
  throw new Error(`Dates must be YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD, not "${text}"`);
}

export function parseVisitArgs(argv: readonly string[]): {
  visit: AuthoredVisit;
  dryRun: boolean;
  geocode: boolean;
} {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      region: { type: "string" },
      label: { type: "string" },
      trip: { type: "string" },
      "day-trip": { type: "boolean", default: false },
      via: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "no-geocode": { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 3)
    throw new Error("Usage: npm run add -- <COUNTRY> <City> <date | start..end> [--region R] [--label L] [--trip T] [--day-trip | --via] [--dry-run] [--no-geocode]");
  const [country, city, dates] = positionals;
  const visit: AuthoredVisit = {
    country: country.toUpperCase(),
    city,
    ...(values.region ? { region: values.region } : {}),
    ...(values.label ? { label: values.label } : {}),
    ...(values.trip ? { trip: values.trip } : {}),
    ...(values["day-trip"] ? { dayTrip: true } : {}),
    ...(values.via ? { via: true } : {}),
    ...parseDates(dates),
  };
  validate(visit, "");
  return { visit, dryRun: values["dry-run"], geocode: !values["no-geocode"] };
}

/** An existing visit with the same country, folded city and dates. */
export function duplicateOf(
  config: Config,
  visit: AuthoredVisit,
): Config["visits"][number] | undefined {
  const [start, end] = dateBounds(visit);
  return config.visits.find(
    (existing) =>
      existing.country === visit.country &&
      fold(existing.city ?? "") === fold(visit.city) &&
      dateBounds(existing)[0] === start &&
      dateBounds(existing)[1] === end,
  );
}

const quote = (value: string) => JSON.stringify(value);
/** Formats one entry in the repository's two-space, trailing-comma style. */
export function formatVisit(visit: AuthoredVisit, indent = "    "): string {
  const inner = `${indent}  `;
  const lines = [
    `country: ${quote(visit.country)}`,
    `city: ${quote(visit.city)}`,
    ...(visit.region ? [`region: ${quote(visit.region)}`] : []),
    ...(visit.label ? [`label: ${quote(visit.label)}`] : []),
    ...(visit.trip ? [`trip: ${quote(visit.trip)}`] : []),
    ...(visit.dayTrip ? ["dayTrip: true"] : []),
    ...(visit.via ? ["via: true"] : []),
    ...(visit.date ? [`date: ${quote(visit.date)}`] : []),
    ...(visit.dateRange
      ? [`dateRange: [${quote(visit.dateRange[0])}, ${quote(visit.dateRange[1])}]`]
      : []),
  ];
  return `${indent}{\n${lines.map((line) => `${inner}${line},`).join("\n")}\n${indent}},`;
}

/**
 * Inserts a visit at the end of the `visits` array literal in data/visits.ts,
 * touching no other byte of the file.
 */
export function insertVisit(source: string, visit: AuthoredVisit): string {
  const file = ts.createSourceFile("visits.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let array: ts.ArrayLiteralExpression | undefined;
  const walk = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "visits" &&
      ts.isArrayLiteralExpression(node.initializer)
    )
      array = node.initializer;
    if (!array) ts.forEachChild(node, walk);
  };
  walk(file);
  if (!array) throw new Error("data/visits.ts has no `visits: [...]` array to extend");
  const found: ts.ArrayLiteralExpression = array;
  const close = found.getEnd() - 1; // position of "]"
  const lineStart = source.lastIndexOf("\n", close) + 1;
  // The closing bracket's own indentation, or the property line's when "[]" shares a line.
  const closingLine = source.slice(lineStart, close);
  const closingIndent = /^\s*$/.test(closingLine)
    ? closingLine
    : (source.slice(lineStart).match(/^\s*/)?.[0] ?? "");
  const indent = `${closingIndent}  `;
  const elements = found.elements;
  let head: string;
  if (!elements.length) {
    head = `${source.slice(0, found.getStart() + 1)}\n`;
    return `${head}${formatVisit(visit, indent)}\n${closingIndent}${source.slice(close)}`;
  }
  const last = elements[elements.length - 1];
  let cursor = last.getEnd();
  // Keep an existing trailing comma; add one when the array had none.
  const afterLast = source.slice(cursor, close);
  const comma = afterLast.match(/^\s*,/);
  if (comma) cursor += comma[0].length;
  head = comma ? source.slice(0, cursor) : `${source.slice(0, cursor)},`;
  return `${head}\n${formatVisit(visit, indent)}${source.slice(lineStart - 1, lineStart)}${source.slice(lineStart)}`;
}

export type CsvRow = { line: number; fields: Record<string, string> };
/** Minimal RFC 4180 reader: comma separated, optional double quotes, LF or CRLF. */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const split = (line: string): string[] => {
    const out: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        out.push(field);
        field = "";
      } else field += char;
    }
    out.push(field);
    return out.map((value) => value.trim());
  };
  const header = split(lines[0] ?? "").map((name) => name.toLowerCase());
  const rows: CsvRow[] = [];
  lines.slice(1).forEach((line, index) => {
    if (!line.trim()) return;
    const values = split(line);
    rows.push({
      line: index + 2,
      fields: Object.fromEntries(header.map((name, column) => [name, values[column] ?? ""])),
    });
  });
  return rows;
}

export function visitFromRow(row: CsvRow): AuthoredVisit {
  const { country, city, start, end, label, trip, region, daytrip, via } = row.fields;
  if (!country || !city || !start) throw new Error(`line ${row.line}: country, city and start are required`);
  const visit: AuthoredVisit = {
    country: country.toUpperCase(),
    city,
    ...(region ? { region } : {}),
    ...(label ? { label } : {}),
    ...(trip ? { trip } : {}),
    ...(/^(1|true|yes|y)$/i.test(daytrip ?? "") ? { dayTrip: true as const } : {}),
    ...(/^(1|true|yes|y)$/i.test(via ?? "") ? { via: true as const } : {}),
    ...(end && end !== start ? { dateRange: [start, end] as [string, string] } : { date: start }),
  };
  validate(visit, `line ${row.line}: `);
  return visit;
}
