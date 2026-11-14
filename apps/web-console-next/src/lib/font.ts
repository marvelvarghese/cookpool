import localFont from "next/font/local";

/**
 * The console's one typeface (MY-24): Plus Jakarta Sans 400/500/600, which the Money
 * boards draw in, now the font of every page. It replaced Outfit in the kitchen, and the
 * "Inter" the console pages named but never loaded (they showed the system font).
 *
 * Self-hosted from the `@fontsource-variable/plus-jakarta-sans` package (SIL OFL 1.1), as
 * Outfit was, so a build never fetches from Google Fonts. The latin subset only: two faces
 * with the same descriptors and no unicode-range would shadow each other, so symbols and
 * scripts outside it (the rupee sign, Devanagari and the other Indic scripts, CJK, Arabic)
 * fall through the `fallback` list, and `--font-sans`'s own system fonts after it, to the
 * device's fonts. `display: swap` shows text at once; `adjustFontFallback` makes next/font
 * emit a size-adjusted Arial fallback, so the swap does not shift the layout.
 *
 * It exposes `--font-jakarta`, which <html> carries (app/layout.tsx), so portals share it.
 */
export const plusJakartaSans = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
      weight: "400 600",
      style: "normal",
    },
  ],
  variable: "--font-jakarta",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
