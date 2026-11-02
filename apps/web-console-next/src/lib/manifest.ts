/**
 * Cookpool's web app manifest (CP-5, icons since CP-23), as data: what makes
 * the app installable to a phone's home screen — its name, Home as the start
 * page, `display: standalone`, the kitchen palette, and the pot mark at 192
 * and 512 pixels plus a maskable one (the icons are in `public/icons/`, made
 * by `scripts/gen-icons.mjs`). The route `/manifest.webmanifest` serves it
 * per request, named for the product the console is deployed as.
 * Dependency-free, so it is unit-testable.
 */

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

/** Herb green and the warm-neutral page: the kitchen palette's primary and background. */
export const THEME_COLOR = "#1F7A4D";
export const BACKGROUND_COLOR = "#F6F7F4";

/** "cookpool" → "Cookpool": the product name as an app's home-screen label. */
export function appName(productName: string): string {
  return productName.charAt(0).toUpperCase() + productName.slice(1);
}

export function buildManifest(productName: string) {
  const name = appName(productName);
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
  };
}
