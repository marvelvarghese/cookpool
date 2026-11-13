/**
 * Light or dark (cookpool-kitchen-calm KC-9): Cookpool follows the phone by
 * default; You's Appearance can pin it to Light or Dark on this device. The
 * choice is `data-look` on <html>, which globals.css and the `cp-dark:`
 * variant read. Stored on this device only.
 */

export type Look = "system" | "light" | "dark";

export const LOOKS: readonly { id: Look; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export const LOOK_KEY = "cookpool.look";

export function parseLook(raw: string | null | undefined): Look {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** Put the look on <html>: an attribute for Light or Dark, none for System. */
export function applyLook(look: Look, root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void }): void {
  if (look === "system") root.removeAttribute("data-look");
  else root.setAttribute("data-look", look);
}

/** Before the first paint: the stored look onto <html>, so a pinned Dark never flashes light. */
export function lookScript(): string {
  return `(function(){try{var l=localStorage.getItem(${JSON.stringify(LOOK_KEY)});if(l==="light"||l==="dark")document.documentElement.setAttribute("data-look",l)}catch(e){}})();`;
}
