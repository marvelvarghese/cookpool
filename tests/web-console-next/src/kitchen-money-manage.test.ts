// money-native MY-11: Manage group. A group on Money's list opens its page;
// the page shows people, the Group card and Leave group; each setting saves
// through the existing calls; the currency rule (risks Q1) blocks a change once
// the group has entries.

import { existsSync, readFileSync } from "node:fs";
import { cwd } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { ManageGroupView, WasteSheet, type ManageGroupViewProps } from "@web-console-next/components/kitchen/money-manage-view";
import {
  CURRENCY_BLOCKED,
  currencyChange,
  hasMoneyEntries,
  isKitchenGroup,
  manageGroupIdFrom,
  manageRights,
  managePeople,
  moneyManageHref,
} from "@web-console-next/components/kitchen/money-manage";
import { moneyGroupHref } from "@web-console-next/components/kitchen/money-native";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

function detail(over: Partial<SplitecoGroupResponse> & { kind?: "kitchen" | "trip"; role?: string } = {}): SplitecoGroupResponse {
  const { kind = "kitchen", role = "owner", ...rest } = over;
  return {
    group: { id: "org_flat", name: "Flat 4B", kind, madeIn: kind === "kitchen" ? "cookpool" : "spliteco", role, currency: "INR", memberCount: 3, myBalanceMinor: 0, myPlan: [], myBuckets: null },
    members: [
      { subjectId: "usr_asha", name: "Asha", role: "builder" },
      { subjectId: "usr_me", name: "Rahul", role: "owner" },
      { subjectId: "usr_kiran", name: "Kiran", role: "builder" },
    ],
    balances: [],
    plan: [],
    buckets: null,
    totalSpentMinor: 0,
    expenses: [],
    people: [],
    canWrite: true,
    settings: { simplifyDebts: true },
    upi: [],
    reminded: [],
    ...rest,
  } as unknown as SplitecoGroupResponse;
}

const noop = () => undefined;
function view(d: SplitecoGroupResponse, over: Partial<ManageGroupViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(ManageGroupView, {
      detail: d,
      meId: "usr_me",
      settings: { currency: "INR", wastePolicy: "split_equally", updatedAt: null },
      joinLink: "https://cookpool.app/join/ABCD2345",
      onBack: noop,
      onSimplify: noop,
      onCurrency: noop,
      onWaste: noop,
      onCopyLink: noop,
      onLeave: noop,
      ...over,
    }),
  );
}

describe("opening Manage group", () => {
  it("a group on Money's list opens /money/group?id=", () => {
    expect(moneyGroupHref("org_flat")).toBe("/money/group?id=org_flat");
    expect(moneyManageHref("org_a b")).toBe("/money/group?id=org_a%20b");
    expect(manageGroupIdFrom(new URLSearchParams("id=org_flat"))).toBe("org_flat");
    expect(manageGroupIdFrom(new URLSearchParams("id=../x"))).toBeNull();
    expect(manageGroupIdFrom(new URLSearchParams(""))).toBeNull();
    expect(existsSync(`${root}/app/(kitchen)/money/group/page.tsx`)).toBe(true);
    expect(read("lib/static-pages.mjs")).toContain('"/money/group"');
    expect(read("components/kitchen/money-native-ui.tsx")).toContain("go(moneyGroupHref(id))");
  });
});

describe("the page", () => {
  it("renders people with balances, the Group card and Leave group", () => {
    const html = view(detail({ balances: [{ subjectId: "usr_asha", balanceMinor: 32000 }, { subjectId: "usr_kiran", balanceMinor: -5000 }] }));
    for (const w of ["Flat 4B", "People", "Rahul", "you", "Asha", "+₹320", "−₹50", "Settled", "Add person", "Simplify debts", "Split by default", "Equal", "Food that goes off", "Split equally", "Currency", "Join link", "Copy", "Leave group"]) {
      expect(html).toContain(w);
    }
    // You first.
    expect(html.indexOf("Rahul")).toBeLessThan(html.indexOf("Asha"));
  });

  it("says Linked to Kitchen on a kitchen group only", () => {
    expect(view(detail())).toContain("Linked to Kitchen");
    const trip = detail({ kind: "trip" });
    expect(isKitchenGroup(trip.group)).toBe(false);
    expect(view(trip, { settings: null })).not.toContain("Linked to Kitchen");
    expect(view(trip, { settings: null })).not.toContain("Food that goes off");
  });

  it("holds no colour or caption of its own: tokens only, flat corners", () => {
    const src = read("components/kitchen/money-manage-view.tsx");
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(src).not.toMatch(/borderRadius: (1[5-9]|2\d)\b/);
    expect(src).toContain("borderRadius: 12");
    expect(src).toContain('theme="cookpool"');
  });

  it("the food rule opens its sheet with the two rules and Save", () => {
    const html = renderToStaticMarkup(createElement(WasteSheet, { current: "buyer_absorbs", onClose: noop, onSave: noop }));
    expect(html).toContain("Split equally");
    expect(html).toContain("The buyer absorbs it");
    expect(html).toContain("Save");
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<button).)*The buyer absorbs it/s);
  });
});

describe("who may change what", () => {
  it("owners and admins of a kitchen group change the rules; others read them", () => {
    expect(manageRights(detail({ role: "owner" })).rules).toBe(true);
    expect(manageRights(detail({ role: "admin" })).rules).toBe(true);
    expect(manageRights(detail({ role: "builder" })).rules).toBe(false);
    expect(manageRights(detail({ kind: "trip", role: "owner" })).rules).toBe(false);
    expect(manageRights(detail({ canWrite: false })).simplify).toBe(false);
  });

  it("a member sees the rows read only: no join link, no Add person, no select, a disabled switch", () => {
    const html = view(detail({ role: "builder", canWrite: false }));
    expect(html).not.toContain("Join link");
    expect(html).not.toContain("Add person");
    expect(html).not.toContain("<select");
    expect(html).toMatch(/role="switch"[^>]*disabled/);
    expect(html).toContain("Split equally");
  });

  it("a manager gets the currency select and the food row as a button", () => {
    const html = view(detail());
    expect(html).toContain("<select");
    expect(html).toContain('data-row="waste"');
    expect(html).toMatch(/<button[^>]*data-row="waste"/);
  });
});

describe("each setting saves through the existing calls", () => {
  const ui = read("components/kitchen/money-manage-ui.tsx");
  it("Simplify debts: spliteco setGroupSettings", () => expect(ui).toContain("client.spliteco.setGroupSettings(id, { simplifyDebts: on }"));
  it("Food that goes off and Currency: kitchen updateSettings", () => {
    expect(ui).toContain("client.kitchen.updateSettings(id, body");
    expect(ui).toContain("saveSettings({ wastePolicy: rule })");
    expect(ui).toContain("saveSettings({ currency: next })");
  });
  it("Join link and Add person copy the join link from getJoinCode", () => {
    expect(ui).toContain("client.memberships.getJoinCode(id");
    expect(ui).toContain("navigator.clipboard?.writeText(link)");
  });
});

describe("the currency rule (risks Q1)", () => {
  it("allows a change while the group has no entries", () => {
    const d = detail();
    expect(hasMoneyEntries(d)).toBe(false);
    expect(currencyChange(d, "INR", "USD")).toEqual({ ok: true });
  });

  it("warns and blocks once the group has entries, with the reason", () => {
    for (const d of [detail({ expenses: [{ id: "txn_1" } as never] }), detail({ totalSpentMinor: 100 }), detail({ balances: [{ subjectId: "usr_asha", balanceMinor: 5 }] })]) {
      expect(hasMoneyEntries(d)).toBe(true);
      expect(currencyChange(d, "INR", "USD")).toEqual({ ok: false, reason: CURRENCY_BLOCKED });
    }
    expect(CURRENCY_BLOCKED).toMatch(/entries/);
  });

  it("choosing the current currency is never a change", () => {
    expect(currencyChange(detail({ totalSpentMinor: 100 }), "INR", "INR")).toEqual({ ok: true });
  });

  it("shows the warning under Currency", () => {
    expect(view(detail(), { currencyWarning: CURRENCY_BLOCKED })).toContain(CURRENCY_BLOCKED.replace("'", "&#x27;"));
  });
});

describe("Leave group", () => {
  const ui = read("components/kitchen/money-manage-ui.tsx");
  it("asks first, then leaves through memberships.leave and goes back to Money", () => {
    expect(ui).toContain("title={`Leave ${group.group.name}?`}");
    expect(ui).toContain('confirmLabel="Leave group"');
    expect(ui).toContain("client.memberships.leave(id");
    expect(ui).toContain("back();");
    expect(ui).toContain("last_owner");
    expect(ui).toContain("balance_not_settled");
  });
  it("the row only opens the confirm", () => expect(view(detail())).toContain('data-action="leave"'));
});

describe("people rows", () => {
  it("puts you first, then by name, with each balance", () => {
    const rows = managePeople(detail({ balances: [{ subjectId: "usr_kiran", balanceMinor: -1 }] }), "usr_me");
    expect(rows.map((r) => r.name)).toEqual(["Rahul", "Asha", "Kiran"]);
    expect(rows[2]?.balanceMinor).toBe(-1);
  });
});
