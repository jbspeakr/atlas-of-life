/** Geography lines for the place caption, omitting a region that merely repeats the place name. */
export function captionGeography(
  place: { label: string; region?: string },
  regionLabels: Record<string, string>,
  countryName: string,
): { region?: string; country: string } {
  const region = place.region ? (regionLabels[place.region] ?? place.region) : undefined;
  const repeats =
    region !== undefined &&
    region.localeCompare(place.label, undefined, { sensitivity: "base" }) === 0;
  return { ...(region && !repeats ? { region } : {}), country: countryName };
}
