/** Locale-aware wording shared by every surface. */
export const deterministic =
  new URLSearchParams(location.search).get("deterministic") === "1";
const locale = (() => {
  const preferred = deterministic ? "en-GB" : navigator.language || "en-GB";
  try {
    return Intl.DisplayNames.supportedLocalesOf([preferred])[0] ?? "en-GB";
  } catch {
    return "en-GB";
  }
})();
export const dateFormatter = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat(locale, {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
export const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`));
export const formatMonth = (date: string) =>
  monthFormatter.format(new Date(`${date}T00:00:00Z`));
const countryNames = new Intl.DisplayNames([locale], { type: "region" });
export const countryName = (code: string) => countryNames.of(code) ?? code;
export const numberFormatter = new Intl.NumberFormat(locale);
export const count = (value: number, noun: string, plural = `${noun}s`) =>
  `${numberFormatter.format(value)} ${value === 1 ? noun : plural}`;
export const plural = (value: number, word: string) =>
  `${value} ${value === 1 ? word : `${word}s`}`;
export const percent = (part: number, whole: number) => {
  const share = whole ? (part / whole) * 100 : 0;
  return `${share < 10 ? share.toFixed(1) : Math.round(share)} %`;
};
export const degrees = (value: number, axis: "lat" | "lng") =>
  `${Math.abs(value).toFixed(1)}° ${axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W"}`;
export const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(0)} MB`;
/** Coarse pointers get no keyboard on open and drop it after a search. */
export const coarse = matchMedia("(pointer: coarse)");
export const narrow = matchMedia("(max-width: 700px)").matches;
