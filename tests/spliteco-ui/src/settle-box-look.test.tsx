// money-native MY-6: the settle box holds no colour of its own, in either theme.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoPersonBalance, SplitecoPersonPlanLine } from "@saas/contracts/spliteco";
import { SettleBox, SettleContent, SettleUpContent } from "@saas/spliteco-ui/settle-box-ui";

const THEMES = ["cookpool", "spliteco"] as const;
const api = { recordPayment: async () => undefined };
const noop = () => undefined;

const dev: SplitecoPersonBalance = {
  subjectId: "usr_dev", name: "Dev", balances: [{ currency: "INR", amountMinor: -150000 }], settled: false, upiVpa: "dev@upi", lastRemindedAt: null,
  groups: [
    { groupId: "org_goa", groupName: "Goa trip", kind: "trip", madeIn: "spliteco", currency: "INR", amountMinor: -120000, buckets: null },
    { groupId: "org_k", groupName: "Flat 4B", kind: "kitchen", madeIn: "cookpool", currency: "INR", amountMinor: -30000, buckets: { kitchen: -30000, other: 0 } },
  ],
  plans: [{ groupId: "org_k", groupName: "Flat 4B", currency: "INR", fromSubjectId: "usr_me", toSubjectId: "usr_dev", amountMinor: 30000 } satisfies SplitecoPersonPlanLine],
};

describe.each(THEMES)("settle box in %s", (theme) => {
  const pages = {
    content: renderToStaticMarkup(<SettleContent theme={theme} person={dev} meId="usr_me" api={api} onDone={noop} />),
    button: renderToStaticMarkup(<SettleBox theme={theme} person={dev} meId="usr_me" api={api} />),
    settleUp: renderToStaticMarkup(<SettleUpContent theme={theme} people={[dev]} meId="usr_me" api={api} onDone={noop} />),
  };

  it("draws with tokens only", () => {
    for (const raw of Object.values(pages)) {
      const html = raw.replace(/--look-\w+:#[0-9A-Fa-f]{3,8};?/g, ""); // the scope's own variable declarations
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/rgba?\(/);
    }
    expect(pages.content).toContain("var(--look-primary)");
    expect(pages.content).toContain("var(--look-grab)");
    expect(pages.settleUp).toContain("var(--look-soft)");
  });

  it("the button carries the theme", () => {
    expect(pages.button).toContain(`data-look="${theme}"`);
    expect(pages.button).toContain("Settle ₹1,500");
  });
});
