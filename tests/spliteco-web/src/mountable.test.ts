import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { setPathMapper, to } from "@/lib/paths";
import { settleHref } from "@/lib/home";

// money-inside MN-7: Spliteco's screens can be mounted by Cookpool and Tripeco.

const SRC = `${cwd()}/../../apps/spliteco-web/src`;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("Spliteco's screens, mountable in another app (MN-7)", () => {
  afterEach(() => setPathMapper((p) => p));

  it("import nothing through @/, which another app would read as its own", () => {
    const offenders = files(SRC).filter((f) => /from "@\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("send a path to itself until a host maps it", () => {
    expect(to("/group?id=org_1")).toBe("/group?id=org_1");
    setPathMapper((p) => `/money${p}`);
    expect(to("/group?id=org_1")).toBe("/money/group?id=org_1");
  });

  it("route the screens' own links through the mapper", () => {
    setPathMapper((p) => `/money${p}`);
    expect(settleHref("u_1", null)).toBe("/money/settle");
    for (const page of ["group", "add", "settle", "expense", "scan"]) {
      const src = readFileSync(`${SRC}/app/${page}/page.tsx`, "utf8");
      expect(src).toMatch(/from "\.\.\/\.\.\/lib\/paths"/);
      expect(src).not.toMatch(/href=\{`\/(group|add|settle|expense|scan)/);
    }
  });
});
