/** Locale-independent folding shared by authoring slugs and search matching. */
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
/** A readable ASCII slug derived from the folded form. */
export function slug(value: string): string {
  return fold(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
