import { defineConfig, loadEnv } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const remote =
    env.VITE_BASEMAP !== "bundled" && Boolean(env.VITE_BASEMAP_URL);
  if (env.VITE_BASEMAP === "remote" && !env.VITE_BASEMAP_URL)
    throw new Error(
      "Remote mode requires VITE_BASEMAP_URL: publish a reusable extract or choose VITE_BASEMAP=bundled",
    );
  const origins = new Set<string>();
  if (remote) {
    const url = new URL(env.VITE_BASEMAP_URL);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      throw new Error("VITE_BASEMAP_URL must use HTTPS");
    if (url.hostname === "build.protomaps.com")
      throw new Error(
        "Dated planet builds are extraction sources, never browser basemaps",
      );
    if (
      url.hostname === "huggingface.co" &&
      !/\/resolve\/[a-f0-9]{40}\//.test(url.pathname)
    )
      throw new Error("Hugging Face resolve URLs must pin a full commit SHA");
    origins.add(url.origin);
  }
  for (const origin of (remote ? (env.VITE_TILE_ORIGINS ?? "") : "")
    .split(/\s+/)
    .filter(Boolean)) {
    const url = new URL(origin);
    if (url.origin !== origin)
      throw new Error("VITE_TILE_ORIGINS must contain exact origins");
    origins.add(origin);
  }
  const csp = `default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${[...origins].join(" ")}; worker-src 'self' blob:; child-src blob:; base-uri 'self'; form-action 'none'; object-src 'none'`;
  return {
    base: env.VITE_BASE || "./",
    plugins: [
      {
        name: "atlas-csp",
        apply: "build",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: { "http-equiv": "Content-Security-Policy", content: csp },
              injectTo: "head-prepend",
            },
          ];
        },
      },
      {
        name: "atlas-archive",
        apply: "build",
        closeBundle() {
          if (
            env.ATLAS_FIXTURE === "1" ||
            !existsSync("public/tiles/basemap.pmtiles")
          ) {
            mkdirSync("dist/tiles", { recursive: true });
            copyFileSync(
              "verification/fixtures/basemap.pmtiles",
              "dist/tiles/basemap.pmtiles",
            );
          }
          if (remote) {
            rmSync("dist/tiles", { recursive: true, force: true });
          }
        },
      },
      ...(env.ANALYZE
        ? [
            visualizer({
              filename: "dist/bundle-analysis.html",
              gzipSize: true,
            }),
          ]
        : []),
    ],
    build: { target: "es2022", sourcemap: false },
    server: { host: "127.0.0.1" },
  };
});
