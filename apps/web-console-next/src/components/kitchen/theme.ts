import localFont from "next/font/local";

/**
 * Cookpool's typeface (CP-5), loaded only by the kitchen layout's tree. The
 * font exposes `--font-cookpool`, which `.cookpool` (globals.css) uses as its
 * `--font-sans`.
 *
 * Self-hosted (CP-22): the variable Plus Jakarta Sans files come from the
 * `@fontsource-variable/plus-jakarta-sans` package (SIL OFL 1.1), so a build
 * never fetches from Google Fonts — `next/font/google` made every console
 * build depend on that network call, and a failed fetch failed the build.
 */
const cookpoolFont = localFont({
  src: [
    // The latin subset only, as the Google-hosted setup used. Two faces with
    // the same descriptors and no unicode-range would shadow each other;
    // symbols outside it (₹) fall back to the system font, as before.
    {
      path: "../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
      weight: "200 800",
      style: "normal",
    },
  ],
  variable: "--font-cookpool",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

/**
 * The classes that switch a subtree to Cookpool's light palette and font. The
 * kitchen layout puts them on its wrapper, and on <body> while it is mounted
 * so Radix portals (dialogs, the Add sheet, toasts) render in the same theme.
 */
export const KITCHEN_THEME_CLASSES: readonly string[] = ["cookpool", cookpoolFont.variable];
