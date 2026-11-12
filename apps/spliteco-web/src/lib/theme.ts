// The theme: Dark (the default), Light, or Auto (the device's), kept on this
// device in localStorage (`spliteco.theme`) and applied as data-theme on <html>.

export type ThemeChoice = "dark" | "light" | "auto";
export const THEME_KEY = "spliteco.theme";

export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): "dark" | "light" {
  if (choice === "auto") return prefersLight ? "light" : "dark";
  return choice;
}

export function readTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "auto" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* this page only */
  }
  const light = window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  document.documentElement.dataset.theme = resolveTheme(choice, light);
}

/** Inline, before first paint. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");var l=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches;document.documentElement.dataset.theme=t==="light"||(t==="auto"&&l)?"light":"dark"}catch(e){}`;
