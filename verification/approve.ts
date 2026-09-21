import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeChecks } from "./runtime";

const build = spawnSync("npm", ["run", "build", "--", "--base=/atlas/"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ATLAS_FIXTURE: "1",
    VITE_BASE: "/atlas/",
    VITE_BASEMAP: "bundled",
  },
});
if (build.error || build.status !== 0) {
  console.error(
    `Baseline approval build failed: ${build.error?.message ?? `exit ${build.status}, signal ${build.signal ?? "none"}`}`,
  );
  process.exitCode = 1;
} else {
  const checks = await runtimeChecks(true);
  await mkdir("verification/artifacts", { recursive: true });
  await writeFile(
    "verification/artifacts/approval-report.json",
    JSON.stringify({ checks }, null, 2),
  );
  for (const check of checks)
    console.log(
      `${check.status.toUpperCase()} ${check.id}: ${check.metric} ${check.unit} ${check.comparator} ${check.threshold} — ${check.message}`,
    );
  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}
