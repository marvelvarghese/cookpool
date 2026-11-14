// money-native MY-19: the boards' colours, as tokens, in the box markup (static, no DOM).

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { ExpandButton, type ExpandButtonKind } from "@saas/spliteco-ui/expand-button";
import { SettleContent, SettleUpContent } from "@saas/spliteco-ui/settle-box-ui";

const api = { recordPayment: async () => undefined, paymentReceived: async () => undefined };
const noop = () => undefined;
const dev: SplitecoPersonBalance = {
  subjectId: "usr_dev", name: "Dev", balances: [{ currency: "INR", amountMinor: -150000 }], settled: false, upiVpa: "dev@upi", lastRemindedAt: null,
  groups: [
    { groupId: "org_goa", groupName: "Goa trip", kind: "trip", madeIn: "spliteco", currency: "INR", amountMinor: -120000, buckets: null },
    { groupId: "org_k", groupName: "Flat 4B", kind: "kitchen", madeIn: "cookpool", currency: "INR", amountMinor: -30000, buckets: { kitchen: -30000, other: 0 } },
  ],
  plans: [{ groupId: "org_k", groupName: "Flat 4B", currency: "INR", fromSubjectId: "usr_me", toSubjectId: "usr_dev", amountMinor: 30000 }],
};

describe("colours come from the tokens the boards name (static markup)", () => {
  const html = (kind: ExpandButtonKind, node: React.ReactNode, open: boolean) =>
    renderToStaticMarkup(<ExpandButton kind={kind} label="x" theme="spliteco" defaultOpen={open}>{node}</ExpandButton>);
  it("the box is primary closed and surface open", () => {
    expect(html("settle", "y", false)).toContain("border-radius:12px;background:var(--look-primary)");
    expect(html("settle", "y", true)).toContain("border-radius:20px;background:var(--look-surface)");
  });
  it("the settle box: bg chips and card, primary Paid, soft UPI, grab ring on Cash, line rules", () => {
    const out = html("settle", <SettleContent theme="spliteco" person={dev} meId="usr_me" api={api} onDone={noop} />, true);
    expect(out).toContain("background:var(--look-bg);border-radius:14px");
    expect(out).toContain("background:var(--look-primary);color:var(--look-onPrimary)");
    expect(out).toContain("background:var(--look-soft);color:var(--look-softInk)");
    expect(out).toContain("inset 0 0 0 1px var(--look-grab)");
    expect(out.match(/border-top:1px solid var\(--look-line\)/g)).toHaveLength(2); // a rule above each of the two rows, the first included

  });
  it("Settle up: bg card, soft avatar and button, primary Settle all", () => {
    const out = html("people", <SettleUpContent theme="spliteco" people={[dev]} meId="usr_me" api={api} onDone={noop} />, true);
    expect(out).toContain("background:var(--look-bg);border-radius:14px");
    expect(out).toContain("background:var(--look-soft);color:var(--look-softInk)");
    expect(out).toContain("background:var(--look-primary);color:var(--look-onPrimary)");
  });
});
