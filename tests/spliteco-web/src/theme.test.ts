import { THEME_SCRIPT, resolveTheme } from "@/lib/theme";

describe("theme", () => {
  it("resolves Auto from the device", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("auto", true)).toBe("light");
    expect(resolveTheme("auto", false)).toBe("dark");
  });

  it("applies the stored theme before first paint", () => {
    expect(THEME_SCRIPT).toContain("spliteco.theme");
    expect(THEME_SCRIPT).toContain("dataset.theme");
  });
});
