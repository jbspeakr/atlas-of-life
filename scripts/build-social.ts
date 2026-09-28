import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { camera, ready } from "../verification/browser.ts";
import { startServer } from "../verification/server.ts";

// Renders public/social/card.png (1200×630) from the deterministic globe view.
// Run by hand after data changes, like the recorder; the build never needs Chromium.
const build = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: { ...process.env, VITE_BASE: "/atlas/", VITE_SITE_URL: "" },
});
if (build.status !== 0) {
  console.error("Social card build failed");
  process.exit(1);
}
const server = await startServer("dist", 4181);
const browser = await chromium.launch({
  ...(process.env.ATLAS_CHROMIUM ? { executablePath: process.env.ATLAS_CHROMIUM } : {}),
  args: process.env.ATLAS_SOFTWARE_GL === "1"
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    : [],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // tsx preserves function names with this helper; serialized callbacks need it in the page realm.
  await page.addInitScript(
    'globalThis.__name = (target, value) => Object.defineProperty(target, "name", {value, configurable:true});',
  );
  await page.goto(`${server.origin}/atlas/?deterministic=1`, { waitUntil: "load" });
  await ready(page);
  await camera(page, [12, 40], 1.55);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await mkdir("public/social", { recursive: true });
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  await writeFile("public/social/card.png", png);
  console.log(`public/social/card.png: ${png.byteLength.toLocaleString("en-US")} bytes`);
} finally {
  await browser.close();
  await server.close();
}
