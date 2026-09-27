import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

// Draws the favicon mark (midnight tile, contour ring, lamplight dot) at PWA sizes
// without a browser, so icons are reproducible from this script alone.
const midnight = [8, 15, 24], contour = [43, 57, 71], lamplight = [239, 199, 132];
function render(size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const s = size / 32, samples = 4;
  const radius = 7 * s, ring = 9.5 * s, ringWidth = 1.2 * s, dot = 4 * s, halo = 6.5 * s;
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples, py = y + (sy + 0.5) / samples;
          // Rounded rectangle coverage.
          const dx = Math.max(Math.abs(px - cx) - (size / 2 - radius), 0);
          const dy = Math.max(Math.abs(py - cy) - (size / 2 - radius), 0);
          if (Math.hypot(dx, dy) > radius) continue;
          let color = midnight;
          const d = Math.hypot(px - cx, py - cy);
          if (d <= halo) {
            const t = d <= dot ? 1 : 0.22;
            color = midnight.map((c, i) => c + (lamplight[i] - c) * t);
          } else if (Math.abs(d - ring) <= ringWidth / 2) color = contour;
          r += color[0]; g += color[1]; b += color[2]; a += 255;
        }
      const n = samples * samples, i = (y * size + x) * 4;
      png.data[i] = a ? r / (a / 255) : 0;
      png.data[i + 1] = a ? g / (a / 255) : 0;
      png.data[i + 2] = a ? b / (a / 255) : 0;
      png.data[i + 3] = a / n;
    }
  return PNG.sync.write(png);
}
mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  const bytes = render(size);
  writeFileSync(`public/icons/icon-${size}.png`, bytes);
  console.log(`public/icons/icon-${size}.png: ${bytes.byteLength.toLocaleString("en-US")} bytes`);
}
