// packages/spliteco-ui (cookpool-spliteco SE3): the money screens Cookpool's
// Money tab and the Spliteco app share. The logic (balance card, why list,
// add a bill, Settle up's steps and UPI link) as pure functions, and the parts
// rendered to markup: they carry no styling of their own, only the theme's.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { cwd } from "node:process";
import type { SplitecoExpenseSummary, SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { balanceHeadline, balanceView, bucketParts } from "@saas/spliteco-ui/balance";
import { billRequest, eachText, newBill, toggleBetween } from "@saas/spliteco-ui/bill";
import { AddBillForm, BalanceCard, BucketLine, PayMethods, SettleUp, UpiConfirm, WhyList, methodNote } from "@saas/spliteco-ui/components";
import { formatMoney, parseMoney } from "@saas/spliteco-ui/money";
import { initialSettle, settleStep, upiLink, upiUnavailable } from "@saas/spliteco-ui/settle";
import { BARE_SLOTS, SplitecoUiProvider, plainMoney, withSlots, type SplitecoUiTheme } from "@saas/spliteco-ui/theme";
import { whyAmount, whyRows, whySections } from "@saas/spliteco-ui/why";

const ME = "usr_me";
const ZOYA = "usr_zoya";
const ARJUN = "usr_arjun";
const NOW = new Date("2026-11-12T09:00:00.000Z");
const names = new Map<string, string | null>([[ME, "You"], [ZOYA, "Zoya"], [ARJUN, "Arjun"]]);

function group(over: Partial<SplitecoGroupResponse> = {}): SplitecoGroupResponse {
  return {
    group: { id: "org_flat", name: "Flat 4B", kind: "kitchen", madeIn: "cookpool", role: "builder", currency: "INR", memberCount: 3, myBalanceMinor: -86000, myPlan: [], myBuckets: { kitchen: -86000, other: 0 } },
    members: [ME, ZOYA, ARJUN].map((subjectId) => ({ subjectId, name: names.get(subjectId)!, role: "builder" })),
    balances: [{ subjectId: ZOYA, balanceMinor: 86000 }, { subjectId: ARJUN, balanceMinor: 0 }, { subjectId: ME, balanceMinor: -86000 }],
    plan: [{ fromSubjectId: ME, toSubjectId: ZOYA, amountMinor: 86000 }],
    buckets: null,
    totalSpentMinor: 0,
    expenses: [],
    people: [],
    canWrite: true,
    settings: { simplifyDebts: true },
    upi: [{ subjectId: ZOYA, upiVpa: "zoya@okaxis" }],
    reminded: [],
    ...over,
  };
}

function row(over: Partial<SplitecoExpenseSummary>): SplitecoExpenseSummary {
  return {
    id: "txn_1", groupId: "org_flat", groupName: "Flat 4B", kind: "expense", app: "cookpool", bucket: "kitchen", title: "Milk & curd",
    category: null, method: null, totalMinor: 26000, currency: "INR", occurredAt: NOW.toISOString(), createdAt: NOW.toISOString(), createdBy: ZOYA,
    payers: [], splits: [{ subjectId: ZOYA, paidMinor: 26000, owedMinor: 13000 }, { subjectId: ME, paidMinor: 0, owedMinor: 13000 }],
    myNetMinor: -13000, locked: true, viaDelegation: null, viaAssistant: null, paymentMethod: null, ...over,
  };
}

/** A theme whose every slot names itself, so the markup shows which slot each element took. */
const NAMED: SplitecoUiTheme = { money: plainMoney, slots: Object.fromEntries(Object.keys(BARE_SLOTS).map((k) => [k, `s-${k}`])) as never };
const render = (node: React.ReactNode, theme: SplitecoUiTheme = NAMED) => renderToStaticMarkup(<SplitecoUiProvider theme={theme}>{node}</SplitecoUiProvider>);

describe("the balance card", () => {
  it("says who the caller owes and who is square, and pays the largest first", () => {
    const view = balanceView(group(), ME, names);
    expect(view.rows.map((r) => [r.text, r.amountMinor, r.tone])).toEqual([
      ["You owe Zoya", -86000, "owe"],
      ["Arjun is all square", 0, "settled"],
    ]);
    expect(view.payNext).toEqual({ subjectId: ZOYA, name: "Zoya", amountMinor: 86000 });
    expect(balanceHeadline(view, plainMoney)).toBe("You owe ₹860.00");
  });

  it("someone who owes the caller reads so, and nothing to pay is no button", () => {
    const view = balanceView(group({ plan: [{ fromSubjectId: ZOYA, toSubjectId: ME, amountMinor: 4000 }], balances: [{ subjectId: ME, balanceMinor: 4000 }] }), ME, names);
    expect(view.rows[0]).toMatchObject({ text: "Zoya owes you", tone: "owed" });
    expect(view.payNext).toBeNull();
    expect(render(<BalanceCard view={view} onSettle={() => undefined} />)).not.toContain("Settle up");
  });

  it("renders at most one button, Settle up with the payee, and none for a viewer", () => {
    const html = render(<BalanceCard view={balanceView(group(), ME, names)} title="Flat 4B" onSettle={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Settle up with Zoya");
    expect(html).toContain('class="s-amount s-owe"');
    expect(render(<BalanceCard view={balanceView(group({ canWrite: false }), ME, names)} onSettle={() => undefined} />)).not.toContain("<button");
  });

  it("Spliteco's Kitchen · Other line, signed, only for a group made in Cookpool", () => {
    expect(bucketParts({ kitchen: -86000, other: 400000 }, "INR", plainMoney)).toEqual([
      { label: "Kitchen", amount: "−₹860.00", tone: "owe" },
      { label: "Other", amount: "+₹4000.00", tone: "get" },
    ]);
    expect(bucketParts(null, "INR", plainMoney)).toBeNull();
    const html = render(<BucketLine myBuckets={{ kitchen: 0, other: -100 }} currency="INR" />);
    expect(html).toContain('aria-label="Kitchen ₹0.00, Other −₹1.00"');
    expect(html).toContain('class="s-bucketOwe"');
  });
});

describe("the why list", () => {
  const rows = [
    row({ id: "txn_d", kind: "dish", title: "Paneer tikka", myNetMinor: -21200, splits: [{ subjectId: ME, paidMinor: 0, owedMinor: 21200 }, { subjectId: ZOYA, paidMinor: 84800, owedMinor: 63600 }] }),
    row({ id: "txn_u", kind: "use", title: "Basmati rice", myNetMinor: -20000, splits: [{ subjectId: ME, paidMinor: 0, owedMinor: 20000 }, { subjectId: ARJUN, paidMinor: 20000, owedMinor: 0 }], occurredAt: "2026-11-01T09:00:00.000Z" }),
    row({ id: "txn_g", title: "Gas cylinder", myNetMinor: 60000, splits: [{ subjectId: ME, paidMinor: 90000, owedMinor: 30000 }, { subjectId: ZOYA, paidMinor: 0, owedMinor: 30000 }, { subjectId: ARJUN, paidMinor: 0, owedMinor: 30000 }] }),
    row({ id: "txn_p", kind: "settlement", title: "Payment", myNetMinor: 4000, paymentMethod: "upi", splits: [{ subjectId: ME, paidMinor: 4000, owedMinor: 0 }, { subjectId: ZOYA, paidMinor: 0, owedMinor: 4000 }] }),
    row({ id: "txn_x", title: "Not mine", splits: [{ subjectId: ZOYA, paidMinor: 100, owedMinor: 0 }, { subjectId: ARJUN, paidMinor: 0, owedMinor: 100 }] }),
  ];

  it("lists only what touches the caller, one line each, with what it did to their balance", () => {
    const why = whyRows(rows, ME, names);
    expect(why.map((r) => [r.title, r.detail, whyAmount(r, plainMoney)])).toEqual([
      ["Paneer tikka", "your portion", "₹212.00"],
      ["Gas cylinder", "you paid · split 3", "+₹600.00"],
      ["You paid Zoya", "UPI", "+₹40.00"],
      ["Basmati rice", "your use", "₹200.00"],
    ]);
    expect(whySections(why, NOW).map((s) => [s.title, s.rows.length])).toEqual([["This week", 3], ["Earlier", 1]]);
  });

  it("renders This week and Earlier, and See all past the limit", () => {
    const html = render(<WhyList sections={whySections(whyRows(rows, ME, names), NOW)} limit={2} />);
    expect(html).toContain("This week");
    expect(html).not.toContain("Earlier");
    expect(html).toContain("See all 4");
    expect(render(<WhyList sections={[]} empty="Nothing yet" />)).toContain("Nothing yet");
  });
});

describe("add a bill", () => {
  const members = [ME, ZOYA, ARJUN];

  it("builds an equal split paid by one person, Kitchen when asked", () => {
    const draft = { ...newBill(ME, members), title: "  Gas   cylinder ", amount: "900" };
    expect(billRequest(draft, members, { bucket: "kitchen" })).toEqual({
      ok: true,
      request: { title: "Gas cylinder", totalMinor: 90000, payers: [{ subjectId: ME, amountMinor: 90000 }], split: { method: "equal", participants: members }, bucket: "kitchen" },
    });
    const two = toggleBetween(draft, ARJUN);
    expect(two.between).toEqual([ME, ZOYA]);
    expect(eachText(two, "INR", plainMoney)).toBe("₹450.00 each");
    expect(billRequest(two, members)).toMatchObject({ ok: true, request: { split: { participants: [ME, ZOYA] } } });
    expect("bucket" in (billRequest(two, members) as { request: object }).request).toBe(false);
  });

  it("says what's missing", () => {
    expect(billRequest({ title: "", amount: "0", payerId: "usr_nobody", between: [] }, members)).toEqual({
      ok: false,
      errors: { title: "Say what it was", amount: "Type the amount", payer: "Pick who paid", between: "Pick at least one person" },
    });
  });

  it("renders its four fields and one submit", () => {
    const html = render(<AddBillForm members={members.map((subjectId) => ({ subjectId, name: names.get(subjectId)! }))} me={ME} currency="INR" onSubmit={async () => undefined} />);
    for (const label of ["What was it?", "How much? (INR)", "Who paid?", "Split equally between"]) expect(html).toContain(label);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html.match(/role="checkbox" aria-checked="true"/g)).toHaveLength(3);
  });

  it("starts with what a scan read, and leaves who paid and the split alone (cookpool-ai AI-15)", () => {
    const people = members.map((subjectId) => ({ subjectId, name: names.get(subjectId)! }));
    const html = render(<AddBillForm members={people} me={ME} currency="INR" prefill={{ title: "Beach Shack", amount: "618" }} onSubmit={async () => undefined} />);
    expect(html).toContain('value="Beach Shack"');
    expect(html).toContain('value="618"');
    expect(html.match(/role="checkbox" aria-checked="true"/g)).toHaveLength(3);
    const blank = render(<AddBillForm members={people} me={ME} currency="INR" prefill={null} onSubmit={async () => undefined} />);
    expect(blank).not.toContain('value="Beach Shack"');
    expect(blank.match(/aria-invalid="false" value=""/g)).toHaveLength(2);
  });
});

describe("Settle up", () => {
  it("opens UPI with the payee, amount and note, and records only on I paid", () => {
    expect(upiLink({ vpa: "zoya@okaxis", name: "Zoya", amountMinor: 86000, note: "Flat 4B" })).toBe("upi://pay?pa=zoya%40okaxis&pn=Zoya&am=860.00&cu=INR&tn=Flat%204B");
    expect(upiUnavailable({ vpa: null, name: "Zoya", currency: "INR" })).toContain("hasn't added a UPI ID");
    let s = initialSettle("upi");
    const go = settleStep(s, { type: "go" });
    expect(go.effect).toBe("open_upi");
    s = go.state;
    expect(settleStep(s, { type: "didnt" })).toEqual({ state: { method: "upi", step: "pick", error: null }, effect: null });
    expect(settleStep(s, { type: "paid" }).effect).toBe("record");
    expect(settleStep(initialSettle("cash"), { type: "go" }).effect).toBe("record");
  });

  it("renders the three ways to pay, UPI off when the payee has none", () => {
    const off = upiUnavailable({ vpa: null, name: "Zoya", currency: "INR" });
    const html = render(<PayMethods value="cash" upiOff={off} onPick={() => undefined} note={(m) => methodNote(m, { upiOff: off, amount: "₹860", vpa: null, note: "Flat 4B", payee: "Zoya" })} />);
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toContain('aria-checked="true" aria-disabled="false" class="s-method s-methodOn"');
    expect(html).toMatch(/aria-disabled="true" disabled=""/);
    expect(html).toContain("Records it now. Zoya gets a heads-up.");
  });

  it("the whole flow: the payee, the amount, the main button, and the I paid check", () => {
    const html = render(<SettleUp payee={{ subjectId: ZOYA, name: "Zoya", upiVpa: "zoya@okaxis" }} groupName="Flat 4B" amountMinor={86000} currency="INR" onRecord={async () => undefined} onDone={() => undefined} />);
    expect(html).toContain("You pay Zoya · Flat 4B");
    expect(html).toContain("₹860.00");
    expect(html).toContain("Open UPI app · ₹860.00");
    const confirm = render(<UpiConfirm payee="Zoya" amountText="₹860" link="upi://pay?x" error={null} onPaid={() => undefined} onDidnt={() => undefined} />);
    expect(confirm).toContain("I paid ₹860");
    expect(confirm).toContain("It didn&#x27;t");
  });
});

describe("theming", () => {
  it("draws with the theme's classes and money format only", () => {
    const shout: SplitecoUiTheme = withSlots({ money: (m) => `${m}p`, slots: BARE_SLOTS }, { cardAction: "big-green" });
    const html = render(<BalanceCard view={balanceView(group(), ME, names)} onSettle={() => undefined} />, shout);
    expect(html).toContain('class="big-green"');
    expect(html).toContain("86000p");
    // Bare: no class attribute at all.
    expect(render(<BalanceCard view={balanceView(group(), ME, names)} />, { money: plainMoney, slots: BARE_SLOTS })).not.toContain("class=");
  });

  it("the package's parts hold no colours, sizes or fonts of their own", () => {
    const dir = `${cwd()}/../../packages/spliteco-ui/src`;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(`${dir}/${file}`, "utf8");
      expect(src).not.toMatch(/#[0-9A-Fa-f]{3,6}\b/);
      expect(src).not.toMatch(/className="[^"]+"/);
    }
  });

  it("money as Spliteco types and prints it", () => {
    expect(formatMoney(123456789, "INR")).toBe("₹12,34,567.89");
    expect(parseMoney("1,234.5")).toBe(123450);
  });
});
