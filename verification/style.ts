import { readFileSync } from "node:fs";
import { expression } from "@maplibre/maplibre-gl-style-spec";
import type { Check } from "./types";
export function styleChecks(): Check[] {
  const style = JSON.parse(
    readFileSync("src/generated/style.json", "utf8"),
  ) as {
    state?: Record<string, { default?: unknown }>;
    layers: { id: string; paint?: Record<string, unknown> }[];
  };
  const samples = ["countries", "regions", "pins"].map((id) => {
    const layer = style.layers.find((layer) => layer.id === id);
    const paint =
      layer?.paint?.[id === "pins" ? "circle-opacity" : "fill-opacity"];
    const parsed = expression.createExpression(paint);
    if (parsed.result === "error")
      throw new Error(
        `src/generated/style.json ${id}: invalid opacity ${JSON.stringify(parsed.value)}`,
      );
    return {
      id,
      visible: Array.from({ length: 65 }, (_, i) =>
        Number(
          parsed.value.evaluate({ zoom: i / 4 }, undefined, { visibility: 1 }),
        ),
      ),
      hidden: Array.from({ length: 65 }, (_, i) =>
        Number(
          parsed.value.evaluate({ zoom: i / 4 }, undefined, { visibility: 0 }),
        ),
      ),
    };
  });
  const checks: Check[] = [];
  const gate = (
    id: string,
    metric: number,
    threshold: number,
    comparator: Check["comparator"],
    cause: string,
  ) =>
    checks.push({
      id,
      category: "correctness",
      status:
        Number.isFinite(metric) &&
        (comparator === "lte" ? metric <= threshold : metric >= threshold)
          ? "pass"
          : "fail",
      metric,
      threshold,
      comparator,
      unit: "opacity / zoom",
      message: `src/generated/style.json: ${cause}; measured ${metric}, threshold ${comparator} ${threshold}`,
    });
  gate(
    "zoom.coverage",
    Math.min(
      ...Array.from({ length: 65 }, (_, i) =>
        Math.max(...samples.map((s) => s.visible[i])),
      ),
    ),
    0.05,
    "gte",
    "no empty semantic band at quarter-zoom samples",
  );
  gate(
    "zoom.continuity",
    Math.max(
      ...samples.flatMap((s) =>
        s.visible.slice(1).map((v, i) => Math.abs(v - s.visible[i])),
      ),
    ),
    0.26,
    "lte",
    "adjacent sample opacity delta",
  );
  let violations = 0;
  for (const s of samples) {
    const peak = s.visible.indexOf(Math.max(...s.visible));
    for (let i = 1; i < s.visible.length; i++)
      if (
        i <= peak
          ? s.visible[i] < s.visible[i - 1]
          : s.visible[i] > s.visible[i - 1]
      )
        violations++;
  }
  gate(
    "zoom.monotonic",
    violations,
    0,
    "lte",
    "each rise and fall must be monotonic",
  );
  gate(
    "zoom.overlap",
    Math.min(
      ...[0, 1].map(
        (b) =>
          samples[b].visible.filter(
            (v, i) => v > 0.05 && samples[b + 1].visible[i] > 0.05,
          ).length * 0.25,
      ),
    ),
    0.5,
    "gte",
    "adjacent bands overlap for at least half a zoom",
  );
  gate(
    "zoom.hidden-state",
    Math.max(...samples.flatMap((s) => s.hidden.map(Math.abs))),
    0,
    "lte",
    "filtered feature-state must actually extinguish the emitted layers",
  );
  // A focused journey leaves only its own countries and regions lit: every
  // boundary, outline and name outside it recedes like an unrelated pin.
  const boundaryPaint: [string, string][] = [
    ["countries", "fill-opacity"],
    ["country-outline", "line-opacity"],
    ["regions", "fill-opacity"],
    ["region-outline", "line-opacity"],
    ["country-labels", "text-opacity"],
    ["region-labels", "text-opacity"],
  ];
  let unreceded = 0;
  for (const [id, property] of boundaryPaint) {
    const parsed = expression.createExpression(
      style.layers.find((layer) => layer.id === id)?.paint?.[property],
    );
    if (parsed.result === "error") {
      unreceded++;
      continue;
    }
    for (let i = 0; i <= 64; i++) {
      const at = (dim: number) =>
        Number(parsed.value.evaluate({ zoom: i / 4 }, undefined, { visibility: 1, dim }));
      if (at(0) > 0.01 && at(1) > at(0) * 0.3 + 1e-9) unreceded++;
    }
  }
  gate(
    "focus.recede",
    unreceded,
    0,
    "lte",
    "boundaries outside a focused journey must recede to 30 % or less",
  );
  // Both palettes live in one style: each of these must read differently by
  // day than by night, and the style must open on night before the page says otherwise.
  const themedPaint: [string, string][] = [
    ["water", "fill-color"],
    ["earth", "fill-color"],
    ["countries", "fill-color"],
    ["pins", "circle-color"],
    ["place-labels", "text-color"],
    ["place-labels", "text-halo-color"],
  ];
  let unthemed = style.state?.theme?.default === "dark" ? 0 : 1;
  for (const [id, property] of themedPaint) {
    const colour = (theme: string) => {
      const parsed = expression.createExpression(
        style.layers.find((layer) => layer.id === id)?.paint?.[property],
        null,
        { theme },
      );
      return parsed.result === "error"
        ? null
        : String(parsed.value.evaluate({ zoom: 2 }, { type: "Point", properties: {} } as never));
    };
    const night = colour("dark");
    if (night === null || night === colour("light")) unthemed++;
  }
  checks.push({
    id: "theme.palettes",
    category: "correctness",
    status: unthemed === 0 ? "pass" : "fail",
    metric: unthemed,
    threshold: 0,
    comparator: "lte",
    unit: "count",
    message: `src/generated/style.json: night default and a distinct day colour for ${themedPaint.length} sampled paints; measured ${unthemed} missing, threshold lte 0`,
  });
  return checks;
}
