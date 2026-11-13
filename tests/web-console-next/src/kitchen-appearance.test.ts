import { LOOKS, LOOK_KEY, applyLook, lookScript, parseLook } from "@web-console-next/lib/look";

// cookpool-kitchen-calm KC-9: You's Appearance — System · Light · Dark, on this device.

function root() {
  const attrs = new Map<string, string>();
  return { attrs, setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) };
}

describe("Appearance", () => {
  it("offers System, Light and Dark, System first", () => {
    expect(LOOKS.map((l) => l.label)).toEqual(["System", "Light", "Dark"]);
  });

  it("reads anything unknown as System", () => {
    expect(parseLook("dark")).toBe("dark");
    expect(parseLook("light")).toBe("light");
    expect(parseLook(null)).toBe("system");
    expect(parseLook("purple")).toBe("system");
  });

  it("pins Light or Dark on <html>, and System takes the pin off", () => {
    const r = root();
    applyLook("dark", r);
    expect(r.attrs.get("data-look")).toBe("dark");
    applyLook("system", r);
    expect(r.attrs.has("data-look")).toBe(false);
  });

  it("puts a stored pin on <html> before the first paint", () => {
    const s = lookScript();
    expect(s).toContain(JSON.stringify(LOOK_KEY));
    expect(s).toContain('setAttribute("data-look",l)');
  });
});
