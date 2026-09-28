import { defineConfig, loadEnv } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { serviceWorkerSource } from "./scripts/service-worker.ts";
const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];
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
        name: "atlas-html",
        apply: "build",
        transformIndexHtml(html) {
          const site = env.VITE_SITE_URL?.trim();
          const tags: {
            tag: string;
            attrs: Record<string, string>;
            injectTo: "head-prepend" | "head";
          }[] = [
            {
              tag: "meta",
              attrs: { "http-equiv": "Content-Security-Policy", content: csp },
              injectTo: "head-prepend",
            },
          ];
          if (site) {
            // Social scrapers require absolute image and canonical URLs.
            const origin = new URL(site);
            if (origin.protocol !== "https:")
              throw new Error("VITE_SITE_URL must use HTTPS");
            const base = origin.href.endsWith("/") ? origin.href : `${origin.href}/`;
            html = html
              .replaceAll(
                `content="${env.VITE_BASE || "./"}social/card.png"`,
                `content="${base}social/card.png"`,
              );
            tags.push(
              { tag: "meta", attrs: { property: "og:url", content: base }, injectTo: "head" },
              { tag: "link", attrs: { rel: "canonical", href: base }, injectTo: "head" },
            );
          }
          return { html, tags };
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
      {
        name: "atlas-service-worker",
        apply: "build",
        enforce: "post",
        closeBundle() {
          // Precache the shell: page, hashed assets, fonts, sprites, glyph ranges, icons.
          // Tiles are never precached; a saved archive is served by range from its own cache.
          const files = walk("dist")
            .map((file) => relative("dist", file).split("\\").join("/"))
            .filter(
              (file) =>
                file.startsWith("assets/") ||
                file.startsWith("fonts/") ||
                file.startsWith("sprites/") ||
                file.startsWith("glyphs/Noto Sans Regular/") ||
                file.startsWith("icons/") ||
                ["favicon.svg", "manifest.webmanifest"].includes(file),
            )
            .filter((file) => !file.endsWith(".txt"))
            .sort();
          const precache = ["./", ...files];
          const version = createHash("sha256")
            .update(precache.join("\n"))
            .update(existsSync("dist/index.html") ? statSync("dist/index.html").size.toString() : "")
            .digest("hex")
            .slice(0, 12);
          writeFileSync("dist/sw.js", serviceWorkerSource(precache, version));
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
    // Fine geometry LODs are emitted as hashed assets; never inline them as data URIs.
    build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
    server: { host: "127.0.0.1" },
  };
});
