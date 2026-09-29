import type { LngLat, Map as LibreMap } from "maplibre-gl";
import type { Theme } from "../theme";

export type Star = { x: number; y: number; r: number; a: number; warm: boolean };

/** Side of the repeating star tile, in CSS pixels. */
export const starTile = 1024;

/**
 * A sparse, seeded star tile: about one star per 10,000 px², mostly faint,
 * one in ten warmed towards lamplight. Seeded, so every load and every
 * verification screenshot shows the same sky.
 */
export function starfield(size = starTile, seed = 0x5eed): Star[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: Math.round((size * size) / 10_000) }, () => {
    const tier = random();
    const [r, a] =
      tier < 0.7 ? [0.45, 0.2] : tier < 0.95 ? [0.7, 0.4] : [1.05, 0.65];
    return {
      x: random() * size,
      y: random() * size,
      r: r + random() * 0.2,
      a: a + random() * 0.15,
      warm: random() < 0.1,
    };
  });
}

/** Stars are space, not sky: they fade as the globe fills the view. */
export const starOpacity = (zoom: number) =>
  Math.min(1, Math.max(0, (3.5 - zoom) / 1.5));

/**
 * Screen radius of the globe's visible disc. MapLibre sizes the sphere so the
 * centre matches Mercator scale; the perspective camera then sees slightly
 * less than a hemisphere, so the limb sits inside that radius.
 */
export function globeRadius(zoom: number, lat: number, height: number, fovDegrees: number) {
  const radius = (512 * 2 ** zoom) / (2 * Math.PI) / Math.cos((lat * Math.PI) / 180);
  const focal = (0.5 / Math.tan((fovDegrees * Math.PI) / 360)) * height;
  const distance = focal + radius;
  return (focal * radius) / Math.sqrt(distance * distance - radius * radius);
}

const halo: Record<Theme, [string, number, number]> = {
  // A faint lamplight atmosphere on night; a cool paper shadow on day.
  dark: ["239, 199, 132", 0.12, 0.2],
  light: ["84, 104, 124", 0.16, 0.14],
};

/**
 * Paints what lies behind the globe on a canvas beneath the map: a seeded
 * starfield at night and a soft halo around the limb in both themes. The map
 * canvas is transparent off the sphere, so nothing in the style changes.
 */
export function attachSky(map: LibreMap, initial: Theme, still: () => boolean) {
  const canvas = document.createElement("canvas");
  canvas.className = "sky";
  canvas.setAttribute("aria-hidden", "true");
  map.getContainer().prepend(canvas);
  const context = canvas.getContext("2d");
  let theme = initial;
  let pattern: CanvasPattern | null = null;
  let ratio = 0;
  let last: LngLat | null = null;
  const drift = [0, 0];
  const tile = () => {
    const image = document.createElement("canvas");
    image.width = image.height = Math.round(starTile * ratio);
    const draw = image.getContext("2d")!;
    draw.scale(ratio, ratio);
    for (const star of starfield()) {
      draw.fillStyle = star.warm
        ? `rgba(239, 199, 132, ${star.a})`
        : `rgba(241, 238, 231, ${star.a})`;
      draw.beginPath();
      draw.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      draw.fill();
    }
    return context!.createPattern(image, "repeat");
  };
  const paint = () => {
    if (!context) return;
    const container = map.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    if (ratio !== dpr) {
      ratio = dpr;
      pattern = null;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const zoom = map.getZoom();
    const center = map.getCenter();
    const origin = map.project(center);
    const r = globeRadius(zoom, center.lat, height, map.getVerticalFieldOfView());
    // Parallax: the stars drift at a third of the surface's speed, so they read
    // as far behind the globe. Accumulated per move, so crossing the
    // antimeridian never jumps; still under reduced motion.
    if (last && !still()) {
      const speed = (r * Math.PI) / 180 / 3;
      const lng = ((center.lng - last.lng + 540) % 360) - 180;
      drift[0] = (drift[0] - lng * speed) % starTile;
      drift[1] = (drift[1] + (center.lat - last.lat) * speed) % starTile;
    }
    last = center;
    // Once the disc covers every corner there is no space left to paint.
    const corner = Math.hypot(
      Math.max(origin.x, width - origin.x),
      Math.max(origin.y, height - origin.y),
    );
    if (r >= corner) return;
    context.scale(dpr, dpr);
    const stars = theme === "dark" ? starOpacity(zoom) : 0;
    if (stars > 0) {
      pattern ??= tile();
      if (pattern) {
        pattern.setTransform(
          new DOMMatrix().translate(drift[0], drift[1]).scale(1 / dpr),
        );
        context.globalAlpha = stars;
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
        context.globalAlpha = 1;
      }
    }
    const [rgb, strength, spread] = halo[theme];
    const glow = context.createRadialGradient(
      origin.x, origin.y, r * 0.985,
      origin.x, origin.y, r * (1 + spread),
    );
    glow.addColorStop(0, `rgba(${rgb}, ${strength})`);
    glow.addColorStop(0.35, `rgba(${rgb}, ${strength * 0.4})`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(origin.x, origin.y, r * (1 + spread), 0, Math.PI * 2);
    context.fill();
  };
  map.on("move", paint);
  map.on("resize", paint);
  paint();
  return {
    setTheme(next: Theme) {
      theme = next;
      paint();
    },
    destroy() {
      map.off("move", paint);
      map.off("resize", paint);
      canvas.remove();
    },
  };
}
