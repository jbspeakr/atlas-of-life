import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
const started = Date.now();
const reportPath = "verification/report.json";
mkdirSync("verification", { recursive: true });
rmSync(reportPath, { force: true });
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "verification/run.ts", ...process.argv.slice(2)],
  {
    encoding: "utf8",
    timeout: process.argv.includes("--quick") ? 59000 : 600000,
    maxBuffer: 32 * 1024 * 1024,
  },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (!existsSync(reportPath)) {
  let commit = "uncommitted";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* No HEAD exists before the repository's first commit. */
  }
  const message = `verification/run.ts bootstrap: expected a complete report and exit 0; measured exit ${result.status}, signal ${result.signal}. Likely syntax/import failure or timeout. ${result.error?.message ?? ""} ${result.stderr ?? ""}`;
  const check = {
    id: "verification.bootstrap",
    category: "correctness",
    status: "fail",
    metric: 1,
    unit: "errors",
    threshold: 0,
    comparator: "eq",
    message,
  };
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        commit,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        checks: [check],
        summary: {
          pass: 0,
          fail: 1,
          skip: 0,
          objective: {
            hardFailures: 1,
            p95FrameMs: null,
            firstViewBytes: null,
            firstViewRequests: null,
            visualDiffPixels: null,
            dependencies: null,
            sourceLines: null,
          },
        },
      },
      null,
      2,
    ),
  );
  console.table([
    { id: check.id, status: check.status, metric: 1, threshold: 0 },
  ]);
  console.error(message);
  process.exitCode = 1;
} else process.exitCode = result.status === 0 ? 0 : 1;
