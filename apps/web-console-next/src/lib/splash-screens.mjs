// iPhone splash screens (Cookpool PW-2, cookpool-app design §2): the image an
// iPhone shows while the installed app starts. iOS ignores the manifest for
// this: it needs one `apple-touch-startup-image` link per screen, each an
// image of exactly that screen's pixels, chosen by a media query on the
// device's size and pixel ratio. A phone with no matching link shows a blank
// screen instead, so nothing breaks, it only looks less like an app.
//
// Which sizes: every iPhone screen that runs a current iOS (18 or 26) in
// portrait, the only orientation the manifest allows. That is the iPhone SE
// (2nd and 3rd generation) and every iPhone from the XR and XS on: eleven
// screens. Older iPhones share these sizes or no longer get iOS updates.
// iPads are left out: they need both orientations and many sizes, and
// Cookpool is laid out for phones. Each image is the app icon on the
// kitchen background (#F6F7F4), a few kilobytes as a PNG; iOS fetches only
// the one that matches.
//
// Plain JavaScript (with splash-screens.d.mts beside it) so the icon script
// (scripts/gen-icons.mjs, which draws the files) and the app (the root
// layout's links, src/lib/manifest.ts) share this one table. Dependency-free.

/**
 * The screens, in CSS pixels and device pixel ratio, with the iPhones that
 * have them.
 */
export const IPHONE_SCREENS = Object.freeze([
  { width: 375, height: 667, ratio: 2, phones: "iPhone SE (2nd and 3rd generation)" },
  { width: 414, height: 896, ratio: 2, phones: "iPhone XR, 11" },
  { width: 375, height: 812, ratio: 3, phones: "iPhone XS, 11 Pro, 12 mini, 13 mini" },
  { width: 414, height: 896, ratio: 3, phones: "iPhone XS Max, 11 Pro Max" },
  { width: 390, height: 844, ratio: 3, phones: "iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e" },
  { width: 428, height: 926, ratio: 3, phones: "iPhone 12 Pro Max, 13 Pro Max, 14 Plus" },
  { width: 393, height: 852, ratio: 3, phones: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { width: 430, height: 932, ratio: 3, phones: "iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus" },
  { width: 402, height: 874, ratio: 3, phones: "iPhone 16 Pro, 17, 17 Pro" },
  { width: 420, height: 912, ratio: 3, phones: "iPhone Air" },
  { width: 440, height: 956, ratio: 3, phones: "iPhone 16 Pro Max, 17 Pro Max" },
]);

/** The icon's size on the splash screen, in CSS pixels (the image is drawn at the screen's ratio). */
export const SPLASH_ICON_CSS = 120;

/** A screen's image: its path under public/, and its size in device pixels. */
export function splashFile(screen) {
  const w = screen.width * screen.ratio;
  const h = screen.height * screen.ratio;
  return { src: `/splash/iphone-${w}x${h}.png`, width: w, height: h };
}

/** The media query that picks a screen's image (portrait only). */
export function splashMedia(screen) {
  return `(device-width: ${screen.width}px) and (device-height: ${screen.height}px) and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)`;
}

/** The root layout's links: `{ url, media }`, one per screen (Next's `appleWebApp.startupImage`). */
export function splashLinks(screens = IPHONE_SCREENS) {
  return screens.map((screen) => ({ url: splashFile(screen).src, media: splashMedia(screen) }));
}
