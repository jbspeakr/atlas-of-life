import type { ExpressionSpecification } from "maplibre-gl";

const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^(#|rgba?\(|hsla?\()/.test(value);

/**
 * Merges the same style fragment rendered with two palettes into one. The two
 * must share their shape and differ only in colour literals; each differing
 * colour becomes a `case` on `light`, placed at the leaf so zoom expressions
 * stay top-level. Anything else that differs is a palette leak and throws.
 */
export function mergeThemes(
  dark: unknown,
  light: unknown,
  isLight: ExpressionSpecification,
  path = "",
): unknown {
  if (JSON.stringify(dark) === JSON.stringify(light)) return dark;
  if (isColor(dark) && isColor(light)) return ["case", isLight, light, dark];
  if (Array.isArray(dark) && Array.isArray(light) && dark.length === light.length)
    return dark.map((value, i) =>
      mergeThemes(value, light[i], isLight, `${path}[${i}]`),
    );
  if (
    dark &&
    light &&
    typeof dark === "object" &&
    typeof light === "object" &&
    !Array.isArray(dark) &&
    !Array.isArray(light)
  ) {
    const keys = Object.keys(dark);
    if (JSON.stringify(keys) === JSON.stringify(Object.keys(light)))
      return Object.fromEntries(
        keys.map((key) => [
          key,
          mergeThemes(
            (dark as Record<string, unknown>)[key],
            (light as Record<string, unknown>)[key],
            isLight,
            `${path}.${key}`,
          ),
        ]),
      );
  }
  throw new Error(
    `Themes differ in more than colour at ${path || "root"}: ${JSON.stringify(dark)} vs ${JSON.stringify(light)}`,
  );
}
