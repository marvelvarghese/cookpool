/**
 * The class that marks the new look's frame (`newFrame()`, RV-2): with it, the
 * `.cookpool` palette follows `prefers-color-scheme` into dark (globals.css).
 * Today's frame (prod) never gets it, so it stays light: its screens still
 * carry raw light colours that a dark ground would make unreadable.
 */
export const KITCHEN_NEW_LOOK_CLASS = "cookpool-new";

/**
 * The classes that switch a subtree to Cookpool's palette (the font is the whole console's: `plusJakartaSans`, app/layout.tsx). The
 * kitchen layout puts them on its wrapper, and on <body> while it is mounted
 * so Radix portals (dialogs, the Add sheet, toasts) render in the same theme.
 */
export const KITCHEN_THEME_CLASSES: readonly string[] = ["cookpool"];
