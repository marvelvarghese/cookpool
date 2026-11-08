/**
 * Cookpool's web app manifest (CP-5, icons since CP-23), as data: what makes
 * the app installable to a phone's home screen — its name, Home as the start
 * page, `display: standalone`, the kitchen palette, and the pot mark at 192
 * and 512 pixels plus a maskable one (the icons are in `public/icons/`, made
 * by `scripts/gen-icons.mjs`). The route `/manifest.webmanifest` serves it
 * per request, named for the product the console is deployed as.
 *
 * PW-2 (cookpool-app design §2) adds what makes it worth installing:
 * `shortcuts` (long-press the icon: Log a use, Bought food, Cook, each with
 * its + Add tile's icon), `screenshots` (two phone screens, so Android's
 * install sheet shows the app), and iPhone splash screens, which iOS takes
 * from links in the page instead (`APPLE_SPLASH_SCREENS`). The `id` stays
 * `/home`, so existing installs keep working.
 * Dependency-free, so it is unit-testable.
 */

import { splashLinks } from "./splash-screens.mjs";

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
}

/** The icons, by the path the console serves them at. */
export const MANIFEST_ICONS: readonly ManifestIcon[] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
];

/** The home-screen icon iOS uses (it ignores the manifest's). */
export const APPLE_TOUCH_ICON = "/icons/apple-touch-icon.png";

/**
 * iPhone splash screens (PW-2): one `apple-touch-startup-image` link per
 * iPhone screen, `{ url, media }` as Next's `appleWebApp.startupImage` takes
 * them. The table and why these sizes: `splash-screens.mjs`.
 */
export const APPLE_SPLASH_SCREENS: readonly { url: string; media: string }[] = splashLinks();

export interface ShortcutIcon {
  src: string;
  sizes: string;
  type: string;
  /** Drawn full-bleed with the glyph inside the safe zone, so it works either way. */
  purpose: "any maskable";
}

export interface ManifestShortcut {
  name: string;
  url: string;
  icons: ShortcutIcon[];
}

const shortcutIcon = (name: string): ShortcutIcon => ({
  src: `/icons/shortcut-${name}-96.png`,
  sizes: "96x96",
  type: "image/png",
  purpose: "any maskable",
});

/**
 * Long-press the home-screen icon (Android; desktop Chrome's app menu): the
 * three things people do most, straight to their screens. Each icon is its
 * + Add tile's (Used · Bought · Cooked), in the tile's colours.
 */
export const MANIFEST_SHORTCUTS: readonly ManifestShortcut[] = [
  { name: "Log a use", url: "/use", icons: [shortcutIcon("use")] },
  { name: "Bought food", url: "/pantry/new", icons: [shortcutIcon("bought")] },
  { name: "Cook", url: "/cook", icons: [shortcutIcon("cook")] },
];

/**
 * The new frame's shortcuts (cookpool-recipes RC-2, design §1.2): the two
 * things people do most from the home screen — "What did you use?" and
 * "Start cooking" (today's cook screen until RC-6's session). Bought is on
 * Pantry's top, so it is not a shortcut any more.
 */
export const NEW_FRAME_SHORTCUTS: readonly ManifestShortcut[] = [
  { name: "What did you use?", url: "/use", icons: [shortcutIcon("use")] },
  { name: "Start cooking", url: "/cook", icons: [shortcutIcon("cook")] },
];

export interface ManifestScreenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: "narrow" | "wide";
  label: string;
}

/**
 * Two phone screens (390×844 at 1.5x, from the mock-harness build), for the
 * richer install sheet Android shows when a manifest has a description and
 * narrow screenshots. In `public/screenshots/`.
 */
export const MANIFEST_SCREENSHOTS: readonly ManifestScreenshot[] = [
  { src: "/screenshots/home.png", sizes: "585x1266", type: "image/png", form_factor: "narrow", label: "Home: your money, your usuals and what needs you" },
  { src: "/screenshots/pantry.png", sizes: "585x1266", type: "image/png", form_factor: "narrow", label: "Pantry: what you have and what to use soon" },
];

/** Herb green and the warm-neutral page: the kitchen palette's primary and background. */
export const THEME_COLOR = "#1F7A4D";
export const BACKGROUND_COLOR = "#F6F7F4";

/** "cookpool" → "Cookpool": the product name as an app's home-screen label. */
export function appName(productName: string): string {
  return productName.charAt(0).toUpperCase() + productName.slice(1);
}

/** The manifest; with `newFrame` (everywhere but prod, RC-2), the new frame's shortcuts. */
export function buildManifest(productName: string, opts: { newFrame?: boolean } = {}) {
  const name = appName(productName);
  const shortcuts = opts.newFrame ? NEW_FRAME_SHORTCUTS : MANIFEST_SHORTCUTS;
  return {
    id: "/home",
    name,
    short_name: name,
    description: "Cook together, share a pantry, and split what it costs.",
    lang: "en",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    orientation: "portrait-primary",
    categories: ["food", "lifestyle"],
    icons: MANIFEST_ICONS.map((icon) => ({ ...icon })),
    shortcuts: shortcuts.map((s) => ({ ...s, icons: s.icons.map((icon) => ({ ...icon })) })),
    screenshots: MANIFEST_SCREENSHOTS.map((shot) => ({ ...shot })),
  };
}
