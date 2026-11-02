import { existsSync, readFileSync } from "node:fs";
import { cwd } from "node:process";
import { APPLE_TOUCH_ICON, MANIFEST_ICONS, buildManifest } from "@web-console-next/lib/manifest";
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
