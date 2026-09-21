import ts from "typescript";
const allowlist: Record<string, true> = {
  id: true,
  label: true,
  country: true,
  region: true,
  city: true,
  coordinates: true,
  date: true,
  dateRange: true,
  visitCount: true,
};
/** Audit object shapes in both standalone JSON and minified production JavaScript. */
export function payloadViolations(
  filename: string,
  text: string,
  expected: Record<string, number[]> = {},
): string[] {
  const violations: string[] = [];
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) inspect(item);
      return;
    }
    const object = value as Record<string, unknown>;
    if ("id" in object && "label" in object && "country" in object) {
      for (const key of Object.keys(object))
        if (allowlist[key] !== true)
          violations.push(
            `${filename}: place ${String(object.id)} contains forbidden field ${key}`,
          );
      const safe = expected[String(object.id)];
      if (safe && JSON.stringify(object.coordinates) !== JSON.stringify(safe))
        violations.push(
          `${filename}: place ${String(object.id)} coordinates ${JSON.stringify(object.coordinates)} do not match precision-safe ${JSON.stringify(safe)}`,
        );
    }
    if (object.type === "Feature" && object.geometry && object.properties) {
      const geometry = object.geometry as Record<string, unknown>;
      const props = object.properties as Record<string, unknown>;
      const safe = expected[String(props.id)];
      if (
        geometry.type === "Point" &&
        safe &&
        JSON.stringify(geometry.coordinates) !== JSON.stringify(safe)
      )
        violations.push(
          `${filename}: pin geometry for ${String(props.id)} violates publication precision`,
        );
    }
    for (const child of Object.values(object)) inspect(child);
  }
  if (/\.(json|geojson)$/.test(filename)) {
    inspect(JSON.parse(text));
    return violations;
  }
  if (!/\.js$/.test(filename)) return violations;
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  function walk(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map<string, ts.Expression>();
      for (const property of node.properties)
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        )
          properties.set(property.name.text, property.initializer);
      const keys = [...properties.keys()];
      if (
        keys.includes("id") &&
        keys.includes("label") &&
        keys.includes("country")
      ) {
        for (const key of keys)
          if (allowlist[key] !== true)
            violations.push(
              `${filename}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: shipped place contains forbidden field ${key}`,
            );
        const id = properties.get("id")!;
        const coordinates = properties.get("coordinates");
        if (ts.isStringLiteral(id) && expected[id.text]) {
          const actual =
            coordinates && ts.isArrayLiteralExpression(coordinates)
              ? coordinates.elements.map((element) =>
                  Number(element.getText(source)),
                )
              : null;
          if (JSON.stringify(actual) !== JSON.stringify(expected[id.text]))
            violations.push(
              `${filename}: emitted JavaScript coordinates for ${id.text} violate publication precision`,
            );
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  return violations;
}
