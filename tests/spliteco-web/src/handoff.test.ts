// Opened from Cookpool (cookpool-spliteco SE3): /handoff takes a one-time code
// to this app's own session, opens the group, and keeps a "Back to Cookpool"
// address — only ever a Cookpool page of this app's own environment. Sign-in
// offers Google and passkeys on this host now (no build flag).

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { BACK_KEY, cookpoolOriginsFor, handoffNext, readBack, rememberBack, safeBack } from "@/lib/handoff";

const STAGE = "cookpool-spliteco-web-stage.cookpool.workers.dev";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe("where Back to Cookpool may go", () => {
  it("is this environment's Cookpool, on its custom domain or its workers.dev host", () => {
    expect(cookpoolOriginsFor(STAGE)).toEqual(["https://cookpool-web-console-next-stage.cookpool.workers.dev", "https://stage.cookpool.store"]);
    expect(cookpoolOriginsFor("cookpool-spliteco-web-prod.cookpool.workers.dev")).toEqual(["https://cookpool-web-console-next-prod.cookpool.workers.dev", "https://cookpool.store"]);
    expect(safeBack("https://stage.cookpool.store/money?group=org_1", STAGE)).toBe("https://stage.cookpool.store/money?group=org_1");
  });

  it("is never another site, another environment, or a script", () => {
    for (const raw of ["https://cookpool.store/money", "https://evil.example/", "javascript:alert(1)", "//stage.cookpool.store/x", "https://u:p@stage.cookpool.store/", "", null]) {
      expect(safeBack(raw, STAGE)).toBeNull();
    }
    expect(safeBack("https://stage.cookpool.store/", "spliteco.example")).toBeNull();
  });

  it("is any local page when this app runs locally", () => {
    expect(safeBack("http://localhost:3000/money", "localhost:3002")).toBe("http://localhost:3000/money");
    expect(safeBack("http://cookpool-stage.localhost:4100/money", "localhost:3002")).toBe("http://cookpool-stage.localhost:4100/money");
    expect(safeBack("https://stage.cookpool.store/money", "localhost:3002")).toBeNull();
  });

  it("is kept for the tab, and read back only while still safe", () => {
    const s = memory();
    rememberBack(s, "https://stage.cookpool.store/money");
    expect(readBack(s, STAGE)).toBe("https://stage.cookpool.store/money");
    s.setItem(BACK_KEY, "https://evil.example/");
    expect(readBack(s, STAGE)).toBeNull();
    rememberBack(s, null);
    expect(s.getItem(BACK_KEY)).toBeNull();
  });
});

describe("where the handoff opens", () => {
  it("a Cookpool group is its page here; any other own path as it is; else Home", () => {
    expect(handoffNext("/groups/org_abc123")).toBe("/group?id=org_abc123");
    expect(handoffNext("/settle?group=org_1")).toBe("/settle?group=org_1");
    expect(handoffNext("https://evil.example/")).toBe("/");
    expect(handoffNext("//evil.example")).toBe("/");
    expect(handoffNext(null)).toBe("/");
  });
});

describe("the app's source", () => {
  const app = `${cwd()}/../../apps/spliteco-web`;

  it("signs in with Google and passkeys without a build flag", () => {
    const page = readFileSync(`${app}/src/app/sign-in/page.tsx`, "utf8");
    expect(page).not.toContain("NEXT_PUBLIC_SPLITECO_GOOGLE");
    expect(page).toContain("Continue with Google");
    expect(page).toContain("Use a passkey");
    expect(readFileSync(`${app}/next.config.mjs`, "utf8")).not.toContain("NEXT_PUBLIC_SPLITECO_GOOGLE");
  });

  it("scrubs the code from the address and exchanges it once", () => {
    const page = readFileSync(`${app}/src/app/handoff/page.tsx`, "utf8");
    expect(page).toContain('window.history.replaceState(null, "", "/handoff")');
    expect(page).toContain("exchangeHandoff");
    expect(page).toContain("handled.current = true");
  });

  it("works Settle up by the shared rules, with Spliteco's own tiles and slider (SL5)", () => {
    const page = readFileSync(`${app}/src/app/settle/page.tsx`, "utf8");
    expect(page).toContain('from "../../lib/settle"');
    expect(readFileSync(`${app}/src/lib/settle.ts`, "utf8")).toContain('export * from "@saas/spliteco-ui/settle"');
    expect(page).toContain('aria-label="How you paid"');
    expect(page).toContain("<Slider");
  });
});
