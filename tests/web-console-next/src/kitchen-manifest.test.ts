import { existsSync, readFileSync } from "node:fs";
import { cwd } from "node:process";
import {
  APPLE_SPLASH_SCREENS,
  APPLE_TOUCH_ICON,
  MANIFEST_ICONS,
  MANIFEST_SCREENSHOTS,
  MANIFEST_SHORTCUTS,
  buildManifest,
} from "@web-console-next/lib/manifest";
import { IPHONE_SCREENS, splashFile } from "@web-console-next/lib/splash-screens.mjs";
import { GET } from "@web-console-next/app/manifest.webmanifest/route";

// The console's public/ directory, from this package (tests run from tests/web-console-next).
const PUBLIC = `${cwd()}/../../apps/web-console-next/public`;

/** A PNG's width and height, from its IHDR chunk; null when it isn't a PNG. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => bytes[i] === b)) return null;
  const type = String.fromCharCode(...bytes.slice(12, 16));
  if (type !== "IHDR") return null;
  const u32 = (o: number) => ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  return { width: u32(16), height: u32(20) };
}

describe("The installable app: manifest and icons (CP-23)", () => {
  const manifest = buildManifest("cookpool");

  it("has the members an install needs", () => {
    expect(manifest).toMatchObject({
      name: "Cookpool",
      short_name: "Cookpool",
      start_url: "/home",
      scope: "/",
      display: "standalone",
      theme_color: "#1F7A4D",
      background_color: "#F6F7F4",
    });
    expect(manifest.id).toBe("/home");
  });

  it("names icons at 192 and 512, and a maskable one", () => {
    const pngs = manifest.icons.filter((i) => i.type === "image/png");
    expect(pngs.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
    expect(pngs.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(pngs.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
  });

  it("every icon it names is in public/, an image of the stated size", () => {
    expect(existsSync(PUBLIC)).toBe(true);
    for (const icon of MANIFEST_ICONS) {
      const path = `${PUBLIC}${icon.src}`;
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      if (icon.type === "image/png") {
        const [w, h] = icon.sizes.split("x").map(Number);
        expect(pngSize(bytes)).toEqual({ width: w, height: h });
      } else {
        expect(icon.type).toBe("image/svg+xml");
        expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("<svg");
      }
    }
    expect(pngSize(readFileSync(`${PUBLIC}${APPLE_TOUCH_ICON}`))).toEqual({ width: 180, height: 180 });
  });

  it("is what /manifest.webmanifest serves, as a web app manifest", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const served = (await res.json()) as ReturnType<typeof buildManifest>;
    expect(served.start_url).toBe("/home");
    expect(served.display).toBe("standalone");
    expect(served.icons).toEqual(MANIFEST_ICONS.map((i) => ({ ...i })));
  });
});

describe("Worth installing: shortcuts, screenshots and iPhone splash screens (PW-2)", () => {
  const manifest = buildManifest("cookpool");

  it("keeps the id, so installs from before keep working", () => {
    expect(manifest.id).toBe("/home");
    expect(manifest.start_url).toBe("/home");
  });

  it("has three shortcuts: Log a use, Bought food, Cook", () => {
    expect(manifest.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ["Log a use", "/use"],
      ["Bought food", "/pantry/new"],
      ["Cook", "/cook"],
    ]);
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.icons).toEqual([
        { src: expect.stringMatching(/^\/icons\/shortcut-[a-z]+-96\.png$/), sizes: "96x96", type: "image/png", purpose: "any maskable" },
      ]);
    }
  });

  it("has two phone screenshots, with labels, of a size Android shows", () => {
    expect(manifest.screenshots).toHaveLength(2);
    for (const shot of manifest.screenshots) {
      expect(shot).toEqual({ src: expect.stringMatching(/^\/screenshots\/[a-z]+\.png$/), sizes: expect.any(String), type: "image/png", form_factor: "narrow", label: expect.any(String) });
      const [w, h] = shot.sizes.split("x").map(Number) as [number, number];
      // Chrome's rules: each side 320–3840 px, the long side at most 2.3 times the short one; portrait for "narrow".
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(320);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(h / w).toBeLessThanOrEqual(2.3);
      expect(h).toBeGreaterThan(w);
    }
  });

  it("every shortcut icon and screenshot it names is in public/, a PNG of the stated size, and small", () => {
    const files = [...MANIFEST_SHORTCUTS.flatMap((s) => s.icons), ...MANIFEST_SCREENSHOTS];
    for (const file of files) {
      const path = `${PUBLIC}${file.src}`;
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      const [w, h] = file.sizes.split("x").map(Number);
      expect(pngSize(bytes)).toEqual({ width: w, height: h });
      expect(bytes.length).toBeLessThan(file.src.startsWith("/icons/") ? 4_000 : 200_000);
    }
  });

  it("serves the shortcuts and screenshots at /manifest.webmanifest", async () => {
    const served = (await GET().json()) as ReturnType<typeof buildManifest>;
    expect(served.shortcuts).toEqual(MANIFEST_SHORTCUTS.map((s) => ({ ...s })));
    expect(served.screenshots).toEqual(MANIFEST_SCREENSHOTS.map((s) => ({ ...s })));
  });

  it("links a splash screen for each iPhone screen on a current iOS, portrait", () => {
    expect(APPLE_SPLASH_SCREENS).toHaveLength(11);
    expect(APPLE_SPLASH_SCREENS[4]).toEqual({
      url: "/splash/iphone-1170x2532.png",
      media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    });
    expect(new Set(APPLE_SPLASH_SCREENS.map((s) => s.media)).size).toBe(APPLE_SPLASH_SCREENS.length);
    expect(APPLE_SPLASH_SCREENS.map((s) => s.url)).toEqual([
      "/splash/iphone-750x1334.png",
      "/splash/iphone-828x1792.png",
      "/splash/iphone-1125x2436.png",
      "/splash/iphone-1242x2688.png",
      "/splash/iphone-1170x2532.png",
      "/splash/iphone-1284x2778.png",
      "/splash/iphone-1179x2556.png",
      "/splash/iphone-1290x2796.png",
      "/splash/iphone-1206x2622.png",
      "/splash/iphone-1260x2736.png",
      "/splash/iphone-1320x2868.png",
    ]);
  });

  it("every splash image is in public/, exactly its screen's pixels, and all of them stay small", () => {
    let total = 0;
    for (const screen of IPHONE_SCREENS) {
      const file = splashFile(screen);
      const path = `${PUBLIC}${file.src}`;
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      expect(pngSize(bytes)).toEqual({ width: screen.width * screen.ratio, height: screen.height * screen.ratio });
      total += bytes.length;
    }
    expect(total).toBeLessThan(150_000);
  });
});
