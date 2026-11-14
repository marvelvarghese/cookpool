// money-native MY-8: Cookpool's Money is native. /money mounts the shared
// pages with theme `cookpool` under Cookpool's own tab bar, reads and writes
// through the console's client, and never opens the Spliteco app.

import { existsSync, readFileSync } from "node:fs";
import { cwd } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoGroupResponse, SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { GroupsPage } from "@saas/spliteco-ui/groups-ui";
import { LOOK_TOKENS } from "@saas/spliteco-ui/look";
import {
  MONEY_ADD_GROUP_HREF,
  createExpenseFor,
  expenseGroupsFrom,
  idempotencyKeys,
  moneyGroupHref,
  moneyHref,
  moneyViewFrom,
  settleApiFor,
  type MoneyWriteClient,
} from "@web-console-next/components/kitchen/money-native";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

const query = (s: string) => new URLSearchParams(s);

describe("the /money route", () => {
  it("mounts the native page, not the old tab", () => {
    const page = read("app/(kitchen)/money/page.tsx");
    expect(page).toContain("<MoneyNative />");
    expect(page).not.toContain("MoneyInside");
  });

  it("draws the shared pages with theme cookpool and holds no colour of its own", () => {
    const ui = read("components/kitchen/money-native-ui.tsx");
    for (const part of ["<GroupsPage", "<PeopleScreen", "<PersonScreen", "<SettleBox", "<SettleUpBox", "<ExpenseButton"]) expect(ui).toContain(part);
    expect(ui).not.toContain('theme="spliteco"');
    expect(ui.match(/theme="cookpool"/g)?.length).toBeGreaterThanOrEqual(5);
    expect(ui).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(ui).not.toContain("SPLITECO_INSIDE");
  });

  it("has no hand-off to Spliteco", () => {
    for (const file of ["components/kitchen/money-native-ui.tsx", "components/kitchen/money-native.ts", "components/kitchen/money-add-group-ui.tsx"]) {
      const src = read(file);
      expect(src).not.toMatch(/handoff/i);
      expect(src).not.toContain("splitecoOriginFor");
      expect(src).not.toContain("SplitecoMoneyTab");
    }
    // The one place it navigates away is the person's own UPI app, with the link the settle box built.
    expect(read("components/kitchen/money-native-ui.tsx").match(/window\.location\.assign\(([^)]*)\)/g)).toEqual(["window.location.assign(url)"]);
  });

  it("leaves the old tab and its Tripeco use untouched", () => {
    expect(existsSync(`${root}/components/kitchen/money-inside-ui.tsx`)).toBe(true);
    expect(existsSync(`${root}/../../../packages/spliteco-ui/src/money-tab-ui.tsx`)).toBe(true);
  });
});

describe("Cookpool's own tab bar", () => {
  it("is not turned navy on Money", () => {
    const bar = read("components/kitchen/tab-bar.tsx");
    expect(bar).not.toContain("SPLITECO_INSIDE");
    expect(bar).not.toContain('startsWith("/money")');
    expect(bar).toContain("bg-cp-nav-bg");
  });
});

describe("what /money's address names", () => {
  it("is Groups, People or a person", () => {
    expect(moneyViewFrom(query(""))).toEqual({ kind: "groups" });
    expect(moneyViewFrom(null)).toEqual({ kind: "groups" });
    expect(moneyViewFrom(query("side=people"))).toEqual({ kind: "people" });
    expect(moneyViewFrom(query("person=usr_zoya"))).toEqual({ kind: "person", subjectId: "usr_zoya" });
    expect(moneyViewFrom(query("person=../../x&side=people"))).toEqual({ kind: "people" });
  });

  it("round-trips through moneyHref", () => {
    expect(moneyHref({ kind: "groups" })).toBe("/money");
    expect(moneyHref({ kind: "people" })).toBe("/money?side=people");
    expect(moneyHref({ kind: "person", subjectId: "usr_zoya" })).toBe("/money?person=usr_zoya");
  });

  it("opens a group on its Manage page", () => {
    expect(moneyGroupHref("org_flat")).toBe("/money/group?id=org_flat");
  });

  it("sends + Group and Add group to the stub route MY-9 replaces", () => {
    expect(MONEY_ADD_GROUP_HREF).toBe("/money/add-group");
    expect(existsSync(`${root}/app/(kitchen)/money/add-group/page.tsx`)).toBe(true);
    expect(read("components/kitchen/money-native-ui.tsx")).toContain("go(MONEY_ADD_GROUP_HREF)");
  });
});

const summary = (id: string, name: string, myBalanceMinor: number): SplitecoGroupSummary => ({
  id, name, kind: "kitchen", madeIn: "cookpool", role: "owner", currency: "INR", memberCount: 2, myBalanceMinor, myPlan: [], myBuckets: null,
} as SplitecoGroupSummary);

describe("Groups, drawn for Cookpool", () => {
  const html = renderToStaticMarkup(
    createElement(GroupsPage, { theme: "cookpool", groups: [summary("org_flat", "Flat 4B", 86000), summary("org_goa", "Goa trip", -120000)], onSide: () => undefined, onOpenGroup: () => undefined, onAddGroup: () => undefined }),
  );

  it("has the title, one Powered by Spliteco line at 11px, + Group and the Add group row", () => {
    expect(html).toContain(">Money<");
    expect(html.match(/Powered by Spliteco/g)).toHaveLength(1);
    expect(html).toMatch(/data-powered-by="" style="[^"]*font-size:11px/);
    expect(html).toContain('data-action="add-group-top"');
    expect(html).toContain('data-action="add-group-row"');
  });

  it("is in the cookpool scope and carries no link out to Spliteco", () => {
    expect(html).toContain('data-look="cookpool"');
    expect(html).not.toMatch(/href=/);
    expect(html).not.toMatch(/handoff/i);
  });
});

describe("dark, through Cookpool's own palettes", () => {
  const css = read("styles/globals.css");
  const block = (selector: string): string => {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };
  const map = block('.cookpool [data-look="cookpool"]');

  it("maps every look token onto a Cookpool variable", () => {
    for (const token of LOOK_TOKENS) expect(map).toMatch(new RegExp(`--look-${token}: hsl\\(var\\(--[a-z-]+\\)\\) !important;`));
  });

  it("maps to variables that Cookpool's dark palette redefines", () => {
    const used = [...map.matchAll(/hsl\(var\((--[a-z-]+)\)\)/g)].map((m) => m[1]!);
    expect(new Set(used).size).toBeGreaterThan(8);
    // The system-dark block and the pinned-dark block each redefine every variable the mapping reads, except those that are the same in dark.
    const darkSystem = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf('/* KC-9'));
    const darkPinned = css.slice(css.indexOf('html[data-look="dark"] .cookpool.cookpool-new'));
    for (const v of new Set(used)) {
      expect(darkSystem).toContain(`${v}:`);
      expect(darkPinned).toContain(`${v}:`);
    }
  });

  it("lifts an open box over the tab bar, so Save and Paid are not covered", () => {
    expect(css).toMatch(/\[data-slot="floating-button"\]:has\(\[data-expand-button\]\[data-open="true"\]\) \{\s*z-index: 60 !important;/);
  });

  it("keeps light's mapping on Cookpool's cream and herb green", () => {
    expect(map).toContain("--look-bg: hsl(var(--background))");
    expect(map).toContain("--look-primary: hsl(var(--primary))");
    expect(css).toMatch(/\.cookpool \{[^}]*--background: 37\.5 44\.4% 96\.5%/);
  });
});

function fakeClient(log: { op: string; args: unknown[]; key?: string | undefined }[], failFirst = false): MoneyWriteClient {
  let failed = !failFirst;
  const call = (op: string) => async (...args: unknown[]) => {
    const opts = args[args.length - 1] as { idempotencyKey?: string };
    log.push({ op, args: args.slice(0, -1), key: opts.idempotencyKey });
    if (!failed) {
      failed = true;
      throw new Error("offline");
    }
    return { ok: true };
  };
  return { spliteco: { settle: call("settle"), paymentReceived: call("paymentReceived"), createExpense: call("createExpense") } } as unknown as MoneyWriteClient;
}

describe("the settle and expense boxes write through the console's client", () => {
  const pay = { groupId: "org_flat", fromSubjectId: "usr_me", toSubjectId: "usr_zoya", amountMinor: 50000, method: "upi" as const };

  it("records a payment as Spliteco's own settlement call, under an idempotency key", async () => {
    const log: { op: string; args: unknown[]; key?: string | undefined }[] = [];
    await settleApiFor(fakeClient(log), idempotencyKeys(() => "k1")).recordPayment(pay);
    expect(log).toEqual([{ op: "settle", args: ["org_flat", { toSubjectId: "usr_zoya", amountMinor: 50000, method: "upi", note: null }], key: "k1" }]);
  });

  it("records a received payment (Got it) through MY-16's route", async () => {
    const log: { op: string; args: unknown[]; key?: string | undefined }[] = [];
    const body = { fromSubjectId: "usr_zoya", amountMinor: 30000, currency: "INR", method: "cash" as const, note: null };
    await settleApiFor(fakeClient(log), idempotencyKeys(() => "k2")).paymentReceived(body);
    expect(log).toEqual([{ op: "paymentReceived", args: [body], key: "k2" }]);
  });

  it("retries a failed write under the same key, and a landed one is a new write next time", async () => {
    const log: { op: string; args: unknown[]; key?: string | undefined }[] = [];
    let n = 0;
    const api = settleApiFor(fakeClient(log, true), idempotencyKeys(() => `k${++n}`));
    await expect(api.recordPayment(pay)).rejects.toThrow("offline");
    await api.recordPayment(pay);
    await api.recordPayment(pay);
    expect(log.map((l) => l.key)).toEqual(["k1", "k1", "k2"]);
  });

  it("saves an expense through createExpense", async () => {
    const log: { op: string; args: unknown[]; key?: string | undefined }[] = [];
    const body = { description: "Dal", amountMinor: 86000 } as never;
    await createExpenseFor(fakeClient(log), idempotencyKeys(() => "k3"))("org_flat", body);
    expect(log).toEqual([{ op: "createExpense", args: ["org_flat", body], key: "k3" }]);
  });
});

describe("the expense box's groups", () => {
  it("come from each group's read, with its one currency and its people", () => {
    const detail = { group: summary("org_flat", "Flat 4B", 0), members: [{ subjectId: "usr_me", name: "You", role: "owner" }, { subjectId: "usr_zoya", name: null, role: "builder" }] } as unknown as SplitecoGroupResponse;
    expect(expenseGroupsFrom([detail, undefined, null])).toEqual([
      { id: "org_flat", name: "Flat 4B", currency: "INR", members: [{ subjectId: "usr_me", name: "You" }, { subjectId: "usr_zoya", name: null }] },
    ]);
  });
});
