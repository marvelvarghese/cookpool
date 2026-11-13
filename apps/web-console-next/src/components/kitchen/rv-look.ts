/**
 * Two looks the `RvSignIn` and `RvCommunity` boards draw differently in dark
 * mode (cookpool-revamp RV-18), as classes. Dark here is the new look's dark
 * (globals.css): `prefers-color-scheme: dark` inside `.cookpool-new`.
 * Tailwind's `dark:` variant is the admin console's `.dark` class, which
 * next-themes puts on <html> everywhere, so it can't be used for this.
 *
 * Each class is written out whole (Tailwind finds classes in the source text,
 * so a prefix joined at runtime would never be built).
 */

/**
 * A secondary button on the ground: the soft shadow in light, and in dark
 * (where the card has no shadow) a 1 px line instead. No ring in light.
 */
export const CARD_EDGE = "shadow-cp-card ring-inset ring-cp-line cp-dark:ring-1";

/** A two- or three-way tab track (Sign in · Create account, Following · Everyone); the card's grey in dark (RV-23). */
export const SEG_TRACK = "rounded-2xl bg-secondary p-1 cp-dark:bg-cp-card";

/**
 * The chosen tab: the card with its shadow in light, a raised grey in dark
 * (the boards' `segOn`); no ring in either.
 */
export const SEG_ON = "bg-card text-foreground shadow-cp-card cp-dark:bg-border";

/** A tab that isn't chosen. */
export const SEG_OFF = "text-muted-foreground hover:text-foreground";
