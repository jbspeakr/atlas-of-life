export type Theme = "dark" | "light";

const storageKey = "atlas-theme";
/** The browser chrome colour per theme; matches `--bg` in tokens.css. */
const chrome: Record<Theme, string> = { dark: "#080f18", light: "#e9e6df" };

/**
 * Runs inline in <head> before first paint, so a stored or system light theme
 * never flashes dark. `?theme=` pins it for verification and recordings. The
 * build hashes this exact source into the Content Security Policy.
 */
export const themeBootSource = `(()=>{let t;try{t=new URLSearchParams(location.search).get("theme")||localStorage.getItem("${storageKey}")}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t;const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"${chrome.light}":"${chrome.dark}"})()`;

export const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

/** True when the viewer or the URL chose a theme, rather than the system. */
function chosen(): boolean {
  if (new URLSearchParams(location.search).has("theme")) return true;
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

export function applyTheme(theme: Theme, remember: boolean): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", chrome[theme]);
  if (!remember) return;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Private windows may refuse storage; the choice then lasts this visit.
  }
}

/** Follows the system appearance until the viewer picks a theme themselves. */
export function followSystem(onChange: (theme: Theme) => void): () => void {
  const media = matchMedia("(prefers-color-scheme: light)");
  const listener = () => {
    if (chosen()) return;
    const theme: Theme = media.matches ? "light" : "dark";
    applyTheme(theme, false);
    onChange(theme);
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
