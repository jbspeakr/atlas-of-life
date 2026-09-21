import { readFileSync, appendFileSync } from "node:fs";
const report = JSON.parse(readFileSync("verification/report.json", "utf8"));
const text =
  "## Atlas verification\n\n| Objective | Measured |\n|---|---:|\n" +
  Object.entries(report.summary.objective)
    .map(([key, value]) => "| " + key + " | " + value + " |")
    .join("\n") +
  "\n";
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
else console.log(text);
