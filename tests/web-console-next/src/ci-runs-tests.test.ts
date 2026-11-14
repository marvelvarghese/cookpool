import { readFileSync, readdirSync, existsSync } from "node:fs";
import { cwd } from "node:process";

// CI-1: every test component runs its tests in CI. Under `quick-check` the
// Verify job only installed packages and checked the folder; no test ran, so
// a test file that could not even load passed (KC-9, #185).

const TESTS = `${cwd()}/..`;

describe("CI runs the tests (CI-1)", () => {
  it("puts every test component on the verify profile, which runs its tests, build and typecheck", () => {
    // The shim's readdirSync is recursive; a test package is a top-level folder with a component.yaml.
    const comps = [...new Set(readdirSync(TESTS, { recursive: true }).map((p) => p.split("/")[0]))]
      .filter((d) => d !== "node_modules" && existsSync(`${TESTS}/${d}/component.yaml`));
    expect(comps.length).toBeGreaterThanOrEqual(23);
    for (const d of comps) {
      const yaml = readFileSync(`${TESTS}/${d}/component.yaml`, "utf8");
      expect([d, /profile:\s*quick-check/.test(yaml)]).toEqual([d, false]);
      expect([d, /preBuildCommand:\s*pnpm exec turbo run test/.test(yaml)]).toEqual([d, true]);
    }
  });
});
