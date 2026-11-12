import localFont from "next/font/local";

/**
 * Cookpool's typeface (CP-5), loaded only by the kitchen layout's tree. The
 * font exposes `--font-cookpool`, which `.cookpool` (globals.css) uses as its
 * `--font-sans`.
 *
 * Outfit (cookpool-revamp RV-2, design §2), self-hosted as CP-22 set up: the
 * variable font file comes from the `@fontsource-variable/outfit` package
 * (SIL OFL 1.1), so a build never fetches from Google Fonts — `next/font/google`
 * made every console build depend on that network call, and a failed fetch
 * failed the build. It replaced Plus Jakarta Sans. Kitchen screens use only
 * 400 and 500 (globals.css caps heavier weights under `.cookpool`).
 */
const cookpoolFont = localFont({
  src: [
    // The latin subset only, as the Google-hosted setup used. Two faces with
    // the same descriptors and no unicode-range would shadow each other;
    // symbols outside it (₹) fall back to the system font, as before.
    {
      path: "../../../node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-cookpool",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

/**
 * The class that marks the new look's frame (`newFrame()`, RV-2): with it, the
 * `.cookpool` palette follows `prefers-color-scheme` into dark (globals.css).
 * Today's frame (prod) never gets it, so it stays light: its screens still
 * carry raw light colours that a dark ground would make unreadable.
 */
export const KITCHEN_NEW_LOOK_CLASS = "cookpool-new";

/**
 * The classes that switch a subtree to Cookpool's palette and font. The
 * kitchen layout puts them on its wrapper, and on <body> while it is mounted
 * so Radix portals (dialogs, the Add sheet, toasts) render in the same theme.
 */
export const KITCHEN_THEME_CLASSES: readonly string[] = ["cookpool", cookpoolFont.variable];
