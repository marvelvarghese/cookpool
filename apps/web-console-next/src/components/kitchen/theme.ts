import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * Cookpool's typeface (CP-5), loaded only by the kitchen layout's tree. The
 * font exposes `--font-cookpool`, which `.cookpool` (globals.css) uses as its
 * `--font-sans`.
 */
const cookpoolFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cookpool",
  display: "swap",
});

/**
 * The classes that switch a subtree to Cookpool's light palette and font. The
 * kitchen layout puts them on its wrapper, and on <body> while it is mounted
 * so Radix portals (dialogs, the Add sheet, toasts) render in the same theme.
 */
export const KITCHEN_THEME_CLASSES: readonly string[] = ["cookpool", cookpoolFont.variable];
