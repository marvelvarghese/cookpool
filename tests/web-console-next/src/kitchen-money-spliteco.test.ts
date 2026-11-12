// cookpool-spliteco SE3: Cookpool's Money tab runs on spliteco-worker and the
// shared parts of packages/spliteco-ui, drawn in the revamp's look. The
// Spliteco host it hands off to, the handoff address, Cookpool's theme (tokens
// only, weights 400 and 500), the Money tab's parts, and that Cookpool never
// lists a group made in Spliteco nor reads a kitchen's Other balance.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { balanceView } from "@saas/spliteco-ui/balance";
import { BalanceCard } from "@saas/spliteco-ui/components";
import { SplitecoUiProvider } from "@saas/spliteco-ui/theme";
import { MORE_IN_SPLITECO, SPLITECO_LOCAL_ORIGIN, handoffUrl, splitecoOriginFor } from "@/components/kitchen/spliteco-link";
import { COOKPOOL_SPLITECO_THEME } from "@/components/kitchen/spliteco-theme";
import { PUSH_ROWS } from "@/lib/push";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

describe("More in Spliteco", () => {
  it("opens this environment's Spliteco, or the local dev server", () => {
    expect(splitecoOriginFor("stage.cookpool.store", "stage")).toBe("https://cookpool-spliteco-web-stage.cookpool.workers.dev");
    expect(splitecoOriginFor("cookpool.store", "prod")).toBe("https://cookpool-spliteco-web-prod.cookpool.workers.dev");
    expect(splitecoOriginFor("localhost:3000", "stage")).toBe(SPLITECO_LOCAL_ORIGIN);
    expect(splitecoOriginFor("cookpool-stage.localhost:4100", "stage")).toBe(SPLITECO_LOCAL_ORIGIN);
    expect(splitecoOriginFor("example.com", "elsewhere")).toBeNull();
  });

  it("lands on the group, signed in by a one-time code, with the way back to this exact page", () => {
    const url = new URL(handoffUrl("https://cookpool-spliteco-web-stage.cookpool.workers.dev", "hoc_abc", "org_flat", "https://stage.cookpool.store/money?group=org_flat"));
    expect(url.pathname).toBe("/handoff");
    expect(["code", "next", "back"].map((k) => [k, url.searchParams.get(k)])).toEqual(Object.entries({ code: "hoc_abc", next: "/groups/org_flat", back: "https://stage.cookpool.store/money?group=org_flat" }));
    expect(MORE_IN_SPLITECO).toHaveLength(4);
  });

  it("asks identity-worker for the code, then leaves for Spliteco", () => {
    const src = read("components/kitchen/kitchen-money-ui.tsx");
    expect(src).toContain("handoffCode(client, origin)");
    expect(src).toContain("window.location.assign(handoffUrl(origin, code, orgId, window.location.href))");
    expect(read("components/kitchen/kitchen-money-data.ts")).toContain("client.auth.createHandoff({ targetOrigin: origin })");
  });
});

describe("the Money tab on spliteco-worker", () => {
  it("reads a kitchen as Cookpool's view, and writes bills and payments on the Kitchen balance", () => {
    const data = read("components/kitchen/kitchen-money-data.ts");
    expect(data).toContain("client.spliteco.kitchenGroup(orgId!)");
    expect(data).toContain('client.spliteco.createExpense(orgId, { ...request, bucket: "kitchen" }');
    expect(data).toContain('client.spliteco.settle(orgId, { ...body, bucket: "kitchen" }');
    expect(data).not.toMatch(/client\.spliteco\.group\(/);
  });

  it("Money has the Kitchen balance with its why, + Add a bill, and More in Spliteco last", () => {
    const money = read("components/kitchen/money-ui.tsx");
    const order = ["<NetCard", "<KitchenMoney", "<People", "<Groups", "<MoreInSpliteco"].map((s) => money.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(money).toContain("kitchenGroupsOf(");
    expect(read("components/kitchen/kitchen-money-ui.tsx")).toContain('g.madeIn !== "spliteco" && g.kind !== "direct"');
  });

  it("Settle up is the shared flow, recorded on Kitchen", () => {
    const settle = read("components/kitchen/kitchen-settle-ui.tsx");
    expect(settle).toContain("<SettleUp");
    expect(settle).toContain("payKitchen(");
  });

  it.each([
    "components/kitchen/spliteco-theme.ts",
    "components/kitchen/kitchen-money-ui.tsx",
    "components/kitchen/kitchen-settle-ui.tsx",
    "app/(kitchen)/money/settle/page.tsx",
  ])("%s uses tokens, no raw hex, and weights of 400 and 500 only", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(src).not.toMatch(/font-(semibold|bold|extrabold|black)\b/);
  });

  it("draws the shared balance card with the revamp's card, money colours and a quiet pill", () => {
    const view = balanceView(
      {
        group: { id: "org_flat", name: "Flat 4B", kind: "kitchen", madeIn: "cookpool", role: "builder", currency: "INR", memberCount: 2, myBalanceMinor: -86000, myPlan: [], myBuckets: null },
        members: [{ subjectId: "usr_me", name: "You", role: "builder" }, { subjectId: "usr_zoya", name: "Zoya", role: "owner" }],
        balances: [{ subjectId: "usr_me", balanceMinor: -86000 }],
        plan: [{ fromSubjectId: "usr_me", toSubjectId: "usr_zoya", amountMinor: 86000 }],
        buckets: null, totalSpentMinor: 0, expenses: [], people: [], canWrite: true, settings: { simplifyDebts: true }, upi: [], reminded: [],
      },
      "usr_me",
      new Map([["usr_zoya", "Zoya"]]),
    );
    const html = renderToStaticMarkup(createElement(SplitecoUiProvider, { theme: COOKPOOL_SPLITECO_THEME, children: createElement(BalanceCard, { view, onSettle: () => undefined }) }));
    expect(html).toContain("rounded-cp-card");
    expect(html).toContain("text-cp-owe");
    expect(html).toContain("bg-cp-accent-tint");
    expect(html).toContain("₹860.00");
    expect(html).toContain("Settle up with Zoya");
  });
});

describe("notification settings", () => {
  it("list Spliteco's three kinds in the new frame", () => {
    expect(PUSH_ROWS.filter((r) => r.kind.startsWith("spliteco.")).map((r) => [r.kind, r.newFrameOnly])).toEqual([
      ["spliteco.reminder", true],
      ["spliteco.paid_you", true],
      ["spliteco.expense_for_you", true],
    ]);
  });
});

describe("passkeys on the Spliteco host", () => {
  it("the console names it as a WebAuthn related origin, served as JSON", () => {
    const list = JSON.parse(readFileSync(`${root}/../public/.well-known/webauthn`, "utf8")) as { origins: string[] };
    expect(list.origins).toEqual(["https://cookpool-spliteco-web-stage.cookpool.workers.dev", "https://cookpool-spliteco-web-prod.cookpool.workers.dev"]);
    expect(readFileSync(`${root}/../public/_headers`, "utf8")).toMatch(/\/\.well-known\/webauthn\n {2}Content-Type: application\/json/);
  });
});
