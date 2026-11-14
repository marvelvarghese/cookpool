/**
 * @jest-environment jsdom
 */
// money-native MY-6: the settle box and Settle up.

import { jest } from "@jest/globals";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SplitecoPersonBalance, SplitecoPersonGroupBalance, SplitecoPersonPlanLine } from "@saas/contracts/spliteco";
import {
  allocate, gotItRequests, keypadDisplay, keypadMinor, keypadPress, planRows, recordPayments, settleCurrencies, settleGroups, settlementBody,
  type PaymentRequest, type SettleApi,
} from "@saas/spliteco-ui/settle-box";
import { SettleBox, SettleContent, SettleUpBox, SettleUpContent } from "@saas/spliteco-ui/settle-box-ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = "usr_me";
const THEMES = ["cookpool", "spliteco"] as const;

const grp = (groupId: string, groupName: string, amountMinor: number, o: Partial<SplitecoPersonGroupBalance> = {}): SplitecoPersonGroupBalance => ({
  groupId, groupName, kind: "trip", madeIn: "spliteco", currency: "INR", amountMinor, buckets: null, ...o,
});
const kitchen = (amountMinor: number, buckets?: { kitchen: number; other: number }): SplitecoPersonGroupBalance =>
  grp("org_k", "Flat 4B", amountMinor, { kind: "kitchen", madeIn: "cookpool", buckets: buckets ?? { kitchen: amountMinor, other: 0 } });

function person(subjectId: string, name: string, groups: SplitecoPersonGroupBalance[], plans: SplitecoPersonPlanLine[] = [], upiVpa: string | null = "dev@upi"): SplitecoPersonBalance {
  const by = new Map<string, number>();
  for (const g of groups) by.set(g.currency, (by.get(g.currency) ?? 0) + g.amountMinor);
  const balances = [...by].filter(([, a]) => a !== 0).map(([currency, amountMinor]) => ({ currency, amountMinor }));
  return { subjectId, name, balances, settled: balances.length === 0, groups, plans, upiVpa, lastRemindedAt: null };
}

// Read order is not Kitchen first. You owe Dev ₹300 in Kitchen and ₹1,200 in Goa.
const dev = person("usr_dev", "Dev", [grp("org_goa", "Goa trip", -120000), kitchen(-30000)]);
const asha = person("usr_asha", "Asha", [grp("org_goa", "Goa trip", 12000)], [], null);

describe("allocation: Kitchen clears first", () => {
  const groups = settleGroups(dev, "pay", "INR");

  it("lists the groups you owe in, Kitchen first", () => {
    expect(groups.map((g) => g.label)).toEqual(["Kitchen · Flat 4B", "Goa trip"]);
    expect(groups.map((g) => g.owedMinor)).toEqual([30000, 120000]);
  });

  it("All pays every group in full", () => {
    expect(allocate(groups, "all").map((l) => [l.groupId, l.paidMinor])).toEqual([["org_k", 30000], ["org_goa", 120000]]);
  });

  it("Kitchen only pays the Kitchen balance and nothing else", () => {
    const lines = allocate(groups, "kitchen");
    expect(lines.map((l) => [l.groupId, l.paidMinor])).toEqual([["org_k", 30000]]);
    expect(lines[0]!.split).toEqual({ kitchen: 30000, other: 0 });
  });

  it("Custom clears the Kitchen first, then the others (the Settle_Custom board: ₹700)", () => {
    const lines = allocate(groups, "custom", 70000);
    expect(lines.map((l) => [l.groupId, l.paidMinor, l.owedMinor])).toEqual([["org_k", 30000, 30000], ["org_goa", 40000, 120000]]);
  });

  it("Custom under the Kitchen's balance touches only the Kitchen group", () => {
    expect(allocate(groups, "custom", 10000).map((l) => [l.groupId, l.paidMinor])).toEqual([["org_k", 10000]]);
  });

  it("Custom is capped at what is owed and ignores zero", () => {
    expect(allocate(groups, "custom", 99999999).reduce((s, l) => s + l.paidMinor, 0)).toBe(150000);
    expect(allocate(groups, "custom", 0)).toEqual([]);
  });

  it("inside a group made in Cookpool the payment fills Kitchen, then Other", () => {
    const mixed = settleGroups(person("usr_x", "X", [kitchen(-50000, { kitchen: -20000, other: -30000 })]), "pay", "INR");
    const [line] = allocate(mixed, "custom", 35000);
    expect(line!.split).toEqual({ kitchen: 20000, other: 15000 });
  });

  it("Got it reads the groups they owe you", () => {
    expect(settleGroups(asha, "got", "INR").map((g) => g.owedMinor)).toEqual([12000]);
    expect(settleGroups(asha, "pay", "INR")).toEqual([]);
  });

  it("picks the currency with the most open and never sums across currencies", () => {
    const mixedCurrencies = person("usr_y", "Y", [grp("org_a", "A", -10000), grp("org_b", "B", -900, { currency: "USD" })]);
    expect(settleCurrencies(mixedCurrencies, "pay")).toEqual(["INR", "USD"]);
    expect(settleGroups(mixedCurrencies, "pay", "USD").map((g) => g.groupId)).toEqual(["org_b"]);
  });
});

describe("the keypad", () => {
  it("types an amount, two decimals at most, never past what is owed", () => {
    let t = "";
    for (const k of ["7", "0", "0"] as const) t = keypadPress(t, k, 150000);
    expect(keypadMinor(t)).toBe(70000);
    expect(keypadDisplay(t, "INR")).toBe("₹700");
    t = keypadPress(keypadPress(keypadPress(t, ".", 150000), "5", 150000), "0", 150000);
    expect(t).toBe("700.50");
    expect(keypadPress(t, "9", 150000)).toBe("700.50");
    expect(keypadPress("1500", "1", 150000)).toBe("1500");
    expect(keypadPress("700.50", "back", 150000)).toBe("700.5");
  });

  it("starts a decimal with 0 and ignores a second point", () => {
    expect(keypadPress("", ".", 100)).toBe("0.");
    expect(keypadPress("1.", ".", 100)).toBe("1.");
  });
});

describe("recording across groups", () => {
  const reqs: PaymentRequest[] = [
    { groupId: "org_k", fromSubjectId: ME, toSubjectId: "usr_dev", amountMinor: 30000, method: "upi" },
    { groupId: "org_goa", fromSubjectId: ME, toSubjectId: "usr_dev", amountMinor: 120000, method: "upi" },
  ];

  it("sends Spliteco's settlement body for a payment you made", () => {
    expect(settlementBody({ ...reqs[0]!, split: { kitchen: 30000, other: 0 } })).toEqual({ toSubjectId: "usr_dev", amountMinor: 30000, method: "upi", note: null, split: { kitchen: 30000, other: 0 } });
  });

  it("a failure does not stop the rest, and a retry sends only what is left", async () => {
    const calls: string[] = [];
    let goaFails = true;
    const api: SettleApi = {
      recordPayment: async (r) => {
        calls.push(r.groupId);
        if (r.groupId === "org_goa" && goaFails) throw new Error("offline");
      },
    };
    const first = await recordPayments(api, reqs);
    expect(first.recorded).toEqual([`org_k:${ME}:usr_dev`]);
    expect(first.failed.map((f) => f.groupId)).toEqual(["org_goa"]);
    goaFails = false;
    const second = await recordPayments(api, reqs, new Set(first.recorded));
    expect(second.failed).toEqual([]);
    expect(calls).toEqual(["org_k", "org_goa", "org_goa"]);
  });

  it("Got it from a People row is one received record per group, in full", () => {
    const both = person("usr_kiran", "Kiran", [grp("org_goa", "Goa trip", 12000), kitchen(5000)]);
    const out = gotItRequests(both, ME, "INR");
    expect(out.map((r) => [r.groupId, r.fromSubjectId, r.toSubjectId, r.amountMinor])).toEqual([
      ["org_k", "usr_kiran", ME, 5000],
      ["org_goa", "usr_kiran", ME, 12000],
    ]);
  });
});

// ── The box, mounted ──────────────────────────────────────

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const byText = (text: string, scope: ParentNode = host): HTMLButtonElement | undefined =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text);
const text = () => host.textContent ?? "";

function recorder(fail: (r: PaymentRequest, n: number) => boolean = () => false) {
  const calls: PaymentRequest[] = [];
  const api: SettleApi = {
    recordPayment: async (r) => {
      calls.push(r);
      if (fail(r, calls.length)) throw new Error("offline");
    },
  };
  return { api, calls };
}

function mountContent(api: SettleApi, o: Partial<React.ComponentProps<typeof SettleContent>> = {}) {
  const onDone = jest.fn();
  const onRecorded = jest.fn();
  act(() => {
    root.render(<SettleContent theme="cookpool" person={dev} meId={ME} api={api} onDone={onDone} onRecorded={onRecorded} {...o} />);
  });
  return { onDone, onRecorded };
}

describe("the settle box", () => {
  it("offers All, Kitchen and Custom, and Kitchen goes first", () => {
    mountContent(recorder().api);
    expect(byText("All ₹1,500")).toBeTruthy();
    expect(byText("Kitchen ₹300")).toBeTruthy();
    expect(byText("Custom")).toBeTruthy();
    expect(text()).toContain("Kitchen goes first");
    const rows = Array.from(host.querySelectorAll("[data-line]")).map((r) => r.getAttribute("data-line"));
    expect(rows).toEqual(["org_k", "org_goa"]);
  });

  it("All with Cash records one payment per group touched, in that group's currency, then shows the done state", async () => {
    const { api, calls } = recorder();
    const { onDone, onRecorded } = mountContent(api);
    await click(byText("Cash"));
    await click(byText("Paid ₹1,500"));
    expect(calls.map((c) => [c.groupId, c.amountMinor, c.method, c.fromSubjectId, c.toSubjectId])).toEqual([
      ["org_k", 30000, "cash", ME, "usr_dev"],
      ["org_goa", 120000, "cash", ME, "usr_dev"],
    ]);
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Paid Dev ₹1,500");
    await click(byText("Done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("Kitchen only records the Kitchen group alone", async () => {
    const { api, calls } = recorder();
    mountContent(api);
    await click(byText("Kitchen ₹300"));
    expect(text()).toContain("Kitchen only");
    await click(byText("Cash"));
    await click(byText("Paid ₹300"));
    expect(calls.map((c) => [c.groupId, c.amountMinor, c.split])).toEqual([["org_k", 30000, { kitchen: 30000, other: 0 }]]);
  });

  it("Custom types ₹700 on the keypad: Kitchen cleared, then Goa trip ₹400 of ₹1,200", async () => {
    const { api, calls } = recorder();
    mountContent(api);
    await click(byText("Custom"));
    for (const k of ["7", "0", "0"]) await click(host.querySelector(`button[aria-label="${k}"]`));
    expect(host.querySelector("[data-amount]")?.textContent).toBe("₹700");
    expect(text()).toContain("₹800 left to settle");
    expect(host.querySelector('[data-line="org_k"]')?.textContent).toContain("₹300 cleared");
    expect(host.querySelector('[data-line="org_goa"]')?.textContent).toContain("₹400 of ₹1,200");
    await click(byText("Cash"));
    await click(byText("Paid ₹700"));
    expect(calls.map((c) => [c.groupId, c.amountMinor])).toEqual([["org_k", 30000], ["org_goa", 40000]]);
  });

  it("Custom will not go past what is owed, and an empty amount cannot be paid", async () => {
    mountContent(recorder().api);
    await click(byText("Custom"));
    expect((host.querySelector('[data-action="paid"]') as HTMLButtonElement).disabled).toBe(true);
    for (const k of ["9", "9", "9", "9"]) await click(host.querySelector(`button[aria-label="${k}"]`));
    expect(host.querySelector("[data-amount]")?.textContent).toBe("₹999");
    for (const k of ["9", "9"]) await click(host.querySelector(`button[aria-label="${k}"]`));
    expect(host.querySelector("[data-amount]")?.textContent).toBe("₹999");
  });

  it("UPI opens the UPI app with a link and records nothing until Paid", async () => {
    const { api, calls } = recorder();
    const openUpi = jest.fn();
    mountContent(api, { openUpi });
    await click(byText("Open UPI app · ₹1,500"));
    expect(openUpi).toHaveBeenCalledTimes(1);
    expect(String(openUpi.mock.calls[0]![0])).toMatch(/^upi:\/\/pay\?pa=dev%40upi&pn=Dev&am=1500\.00&cu=INR/);
    expect(calls).toEqual([]);
    await click(byText("Paid ₹1,500"));
    expect(calls.map((c) => c.method)).toEqual(["upi", "upi"]);
    expect(text()).toContain("Paid Dev ₹1,500");
  });

  it("Not paid goes back from the UPI app without recording", async () => {
    const { api, calls } = recorder();
    mountContent(api, { openUpi: jest.fn() });
    await click(byText("Open UPI app · ₹1,500"));
    await click(byText("Not paid"));
    expect(calls).toEqual([]);
    expect(byText("Open UPI app · ₹1,500")).toBeTruthy();
  });

  it("with no UPI ID the Paid button records a payment made in the person's UPI app straight away", async () => {
    const { api, calls } = recorder();
    mountContent(api, { person: { ...dev, upiVpa: null }, openUpi: jest.fn() });
    await click(byText("Paid ₹1,500"));
    expect(calls).toHaveLength(2);
  });

  it("a partial failure says which recorded and which did not; Paid sends only the rest", async () => {
    let goaFails = true;
    const { api, calls } = recorder((r) => r.groupId === "org_goa" && goaFails);
    const { onRecorded, onDone } = mountContent(api);
    await click(byText("Cash"));
    await click(byText("Paid ₹1,500"));
    expect(host.querySelector("[data-error]")?.textContent).toBe("Recorded: Kitchen · Flat 4B. Not recorded: Goa trip.");
    expect(host.querySelector('[data-line="org_k"]')?.getAttribute("data-status")).toBe("recorded");
    expect(host.querySelector('[data-line="org_goa"]')?.getAttribute("data-status")).toBe("failed");
    expect(onRecorded).not.toHaveBeenCalled();
    // The amount is locked once something landed, and the button now says what is left.
    expect(byText("Custom")!.disabled).toBe(true);
    expect(byText("Paid ₹1,200")).toBeTruthy();
    goaFails = false;
    await click(byText("Paid ₹1,200"));
    expect(calls.map((c) => c.groupId)).toEqual(["org_k", "org_goa", "org_goa"]);
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Paid Dev ₹1,500");
    await click(byText("Done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("Got it records a payment from them to you", async () => {
    const { api, calls } = recorder();
    mountContent(api, { person: asha, direction: "got" });
    await click(byText("Cash"));
    await click(byText("Got it ₹120"));
    expect(calls.map((c) => [c.groupId, c.fromSubjectId, c.toSubjectId, c.amountMinor])).toEqual([["org_goa", "usr_asha", ME, 12000]]);
    expect(text()).toContain("Asha paid you ₹120");
  });

  it("Got it never opens a UPI app", async () => {
    const { api } = recorder();
    const openUpi = jest.fn();
    mountContent(api, { person: asha, direction: "got", openUpi });
    await click(byText("Got it ₹120"));
    expect(openUpi).not.toHaveBeenCalled();
  });

  it("a person you owe nothing reads All settled", () => {
    mountContent(recorder().api, { person: person("usr_z", "Z", [grp("org_goa", "Goa trip", 0)]) });
    expect(text()).toContain("All settled");
  });
});

describe("the settle button", () => {
  it.each(THEMES)("plugs into the expanding button in %s and opens the box", async (theme) => {
    const { api } = recorder();
    act(() => {
      root.render(<SettleBox theme={theme} person={dev} meId={ME} api={api} reduceMotion />);
    });
    const wrap = host.querySelector("[data-expand-button]")!;
    expect(wrap.getAttribute("data-expand-button")).toBe("settle");
    expect(wrap.getAttribute("data-look")).toBe(theme);
    const launcher = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    expect(launcher.getAttribute("aria-label")).toBe("Settle ₹1,500");
    await click(launcher);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Settle with Dev");
    expect(host.querySelector('[data-box="settle"]')).toBeTruthy();
  });

  it("is empty when nothing is owed", () => {
    act(() => {
      root.render(<SettleBox theme="cookpool" person={asha} meId={ME} api={recorder().api} />);
    });
    expect(host.querySelector("[data-expand-button]")).toBeNull();
  });
});

// ── Settle up ─────────────────────────────────────────────

const line = (groupId: string, from: string, to: string, amountMinor: number, currency = "INR"): SplitecoPersonPlanLine => ({ groupId, groupName: groupId, currency, fromSubjectId: from, toSubjectId: to, amountMinor });
const devP = person("usr_dev", "Dev", [grp("org_goa", "Goa trip", -120000), kitchen(-30000)], [line("org_k", ME, "usr_dev", 30000), line("org_goa", ME, "usr_dev", 120000)]);
const ashaP = person("usr_asha", "Asha", [grp("org_goa", "Goa trip", 12000)], [line("org_goa", "usr_asha", ME, 12000)]);
const people = [devP, ashaP];

describe("Settle up", () => {
  it("lists each simplified payment: You pay Dev ₹1,500 and Asha pays you ₹120", () => {
    const rows = planRows(people, ME);
    expect(rows.map((r) => [r.direction, r.name, r.amountMinor, r.requests.length])).toEqual([["pay", "Dev", 150000, 2], ["got", "Asha", 12000, 1]]);
    act(() => {
      root.render(<SettleUpContent theme="cookpool" people={people} meId={ME} api={recorder().api} onDone={() => undefined} />);
    });
    expect(text()).toContain("You pay Dev");
    expect(text()).toContain("Asha pays you");
    expect(byText("Paid")).toBeTruthy();
    expect(byText("Got it")).toBeTruthy();
    expect(byText("Settle all 2")).toBeTruthy();
  });

  it("Paid records one payment per group in the plan; Got it records one from them to you", async () => {
    const { api, calls } = recorder();
    act(() => {
      root.render(<SettleUpContent theme="cookpool" people={people} meId={ME} api={api} onDone={() => undefined} />);
    });
    await click(byText("Paid"));
    expect(calls.map((c) => [c.groupId, c.fromSubjectId, c.toSubjectId, c.amountMinor])).toEqual([["org_k", ME, "usr_dev", 30000], ["org_goa", ME, "usr_dev", 120000]]);
    expect(byText("Settle all 1")).toBeTruthy();
    await click(byText("Got it"));
    expect(calls[2]).toMatchObject({ groupId: "org_goa", fromSubjectId: "usr_asha", toSubjectId: ME, amountMinor: 12000 });
    expect(text()).toContain("All settled");
  });

  it("Settle all records everything and ends on All settled", async () => {
    const { api, calls } = recorder();
    const onRecorded = jest.fn();
    act(() => {
      root.render(<SettleUpContent theme="spliteco" people={people} meId={ME} api={api} onRecorded={onRecorded} onDone={() => undefined} />);
    });
    await click(byText("Settle all 2"));
    expect(calls).toHaveLength(3);
    expect(onRecorded).toHaveBeenCalled();
    expect(text()).toContain("All settled");
  });

  it("when a group fails it says what recorded and what did not, and Settle all sends only the rest", async () => {
    let fails = true;
    const { api, calls } = recorder((r) => r.groupId === "org_goa" && r.toSubjectId === "usr_dev" && fails);
    act(() => {
      root.render(<SettleUpContent theme="cookpool" people={people} meId={ME} api={api} onDone={() => undefined} />);
    });
    await click(byText("Settle all 2"));
    expect(host.querySelector("[data-error]")?.textContent).toBe("Recorded: Asha pays you. Not recorded: You pay Dev.");
    expect(host.querySelector('[data-row="usr_dev:pay:INR"]')?.getAttribute("data-status")).toBe("failed");
    expect(host.querySelector('[data-row="usr_asha:got:INR"]')?.getAttribute("data-status")).toBe("recorded");
    expect(byText("Settle all 1")).toBeTruthy();
    fails = false;
    const before = calls.length;
    await click(byText("Settle all 1"));
    // Dev's Kitchen payment had landed too; only the Goa trip one is sent again.
    expect(calls.slice(before).map((c) => c.groupId)).toEqual(["org_goa"]);
    expect(text()).toContain("All settled");
  });

  it.each(THEMES)("is the people button in %s", (theme) => {
    act(() => {
      root.render(<SettleUpBox theme={theme} people={people} meId={ME} api={recorder().api} reduceMotion />);
    });
    const wrap = host.querySelector("[data-expand-button]")!;
    expect(wrap.getAttribute("data-expand-button")).toBe("people");
    expect(wrap.getAttribute("data-look")).toBe(theme);
    expect(host.querySelector('button[aria-haspopup="dialog"]')?.getAttribute("aria-label")).toBe("Settle up");
  });

  it("is empty when no group's plan has a payment", () => {
    act(() => {
      root.render(<SettleUpBox theme="cookpool" people={[person("usr_z", "Z", [grp("org_a", "A", 0)])]} meId={ME} api={recorder().api} />);
    });
    expect(host.querySelector("[data-expand-button]")).toBeNull();
  });
});
