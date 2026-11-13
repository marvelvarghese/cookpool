import { readFileSync } from "node:fs";
import { cwd } from "node:process";

// cookpool-kitchen-calm KC-4: the canvas's Item board.

const src = (f: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/${f}`, "utf8");
const kitchen = (f: string) => src(`components/kitchen/${f}`);

describe("the calm item page", () => {
  const page = src("app/(kitchen)/pantry/[itemRef]/page.tsx");
  const parts = kitchen("item-page-ui.tsx");

  it("shows whose it is and which group, and Cook with it as a pill", () => {
    expect(page).toContain("<ItemOwnerChip");
    expect(page).toContain("<CookWithItPill");
  });

  it("has one level line instead of the ring, Runs out and Who had it cards", () => {
    expect(page).toContain("<ItemLevel");
    expect(page).not.toMatch(/<LevelRingCard|<RunOutCard|<WhoHadItCard/);
  });

  it("calls the last amount Other, not More, and the actions read Got more · Finished · Wasted", () => {
    expect(parts).toMatch(/>\s*Other\s*</);
    expect(parts).not.toMatch(/>\s*More\s*</);
    expect(parts).toContain('"Finished"');
  });

  it.each(["components/kitchen/item-page-ui.tsx"])("%s uses tokens only", (f) => {
    const s = src(f);
    expect(s).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(s).not.toMatch(/font-(semibold|bold|extrabold)/);
  });
});
