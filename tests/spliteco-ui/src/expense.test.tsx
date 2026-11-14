/**
 * @jest-environment jsdom
 */
// money-native MY-7: the expense box.

import { jest } from "@jest/globals";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExpenseBox, ExpenseButton } from "@saas/spliteco-ui/expense-ui";
import { equalShares, exactGap, expenseRequest, newExpense, shareRows, type ExpenseGroup } from "@saas/spliteco-ui/expense";
import { lookColours } from "@saas/spliteco-ui/look";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flat: ExpenseGroup = { id: "org_flat", name: "Flat 4B", currency: "INR", members: [{ subjectId: "usr_me", name: "Me" }, { subjectId: "usr_a", name: "Asha" }, { subjectId: "usr_b", name: "Ben" }] };
const trip: ExpenseGroup = { id: "org_trip", name: "Goa", currency: "USD", members: [{ subjectId: "usr_me", name: "Me" }, { subjectId: "usr_c", name: "Cy" }] };
const groups = [flat, trip];

describe("equalShares", () => {
  it("adds up, the leftover paise to the earliest people", () => {
    expect(equalShares(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(equalShares(10001, 3)).toEqual([3334, 3334, 3333]);
    expect(equalShares(100, 3)).toEqual([34, 33, 33]);
    expect(equalShares(1, 3)).toEqual([1, 0, 0]);
    expect(equalShares(500, 1)).toEqual([500]);
  });
  it("always sums to the total", () => {
    for (const [t, n] of [[99999, 7], [1, 5], [12345, 4], [0, 3]] as const) {
      expect(equalShares(t, n).reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
});

describe("expense logic", () => {
  const draft = (o = {}) => ({ ...newExpense(flat, "usr_me"), amount: "100", description: "Dinner", ...o });
  it("Equal: shows each share and builds an equal split", () => {
    expect(shareRows(draft(), flat).map((r) => r.shareMinor)).toEqual([3334, 3333, 3333]);
    const c = expenseRequest(draft(), groups);
    expect(c).toEqual({ ok: true, request: { title: "Dinner", totalMinor: 10000, currency: "INR", payers: [{ subjectId: "usr_me", amountMinor: 10000 }], split: { method: "equal", participants: ["usr_me", "usr_a", "usr_b"] } } });
  });
  it("Equal: only the ticked share it", () => {
    const d = draft({ between: ["usr_a", "usr_b"] });
    expect(shareRows(d, flat).map((r) => r.shareMinor)).toEqual([0, 5000, 5000]);
    expect(expenseRequest(d, groups)).toMatchObject({ ok: true, request: { split: { participants: ["usr_a", "usr_b"] } } });
    expect(expenseRequest(draft({ between: [] }), groups)).toMatchObject({ ok: false, errors: { between: expect.any(String) } });
  });
  it("Exact: must add up before it is valid", () => {
    const d = draft({ method: "exact", exact: { usr_me: "40", usr_a: "30" } });
    expect(exactGap(d, flat)).toBe(3000);
    expect(expenseRequest(d, groups)).toMatchObject({ ok: false, errors: { exact: expect.any(String) } });
    expect(exactGap({ ...d, exact: { usr_me: "60", usr_a: "50" } }, flat)).toBe(-1000);
    const ok = expenseRequest({ ...d, exact: { usr_me: "40", usr_a: "30", usr_b: "30" } }, groups);
    expect(ok).toMatchObject({ ok: true, request: { split: { method: "exact", participants: [{ subjectId: "usr_me", amountMinor: 4000 }, { subjectId: "usr_a", amountMinor: 3000 }, { subjectId: "usr_b", amountMinor: 3000 }] } } });
  });
  it("Exact: a zero share leaves the person out; junk blocks", () => {
    const d = draft({ method: "exact", exact: { usr_me: "100" } });
    expect(expenseRequest(d, groups)).toMatchObject({ ok: true, request: { split: { participants: [{ subjectId: "usr_me", amountMinor: 10000 }] } } });
    expect(exactGap({ ...d, exact: { usr_me: "abc" } }, flat)).toBeNull();
  });
  it("needs an amount and a description", () => {
    expect(expenseRequest(draft({ amount: "" }), groups)).toMatchObject({ ok: false, errors: { amount: expect.any(String) } });
    expect(expenseRequest(draft({ description: " " }), groups)).toMatchObject({ ok: false, errors: { description: expect.any(String) } });
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const type = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};
const q = <T extends Element>(s: string) => host.querySelector<T>(s)!;
const save = () => q<HTMLButtonElement>('[data-action="save"]');
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

describe("ExpenseBox", () => {
  const mount = (o: Partial<React.ComponentProps<typeof ExpenseBox>> = {}) => {
    const createExpense = jest.fn(async () => ({}));
    const onSaved = jest.fn();
    const onClose = jest.fn();
    act(() => root.render(<ExpenseBox theme="cookpool" groups={groups} me="usr_me" createExpense={createExpense} onSaved={onSaved} onClose={onClose} {...o} />));
    return { createExpense, onSaved, onClose };
  };

  it("has the fields, Equal | Exact only, and no pointer text", () => {
    mount();
    expect(host.querySelector('[name="amount"]')).not.toBeNull();
    expect(host.querySelector('[name="description"]')).not.toBeNull();
    expect(host.querySelector('[name="group"]')).not.toBeNull();
    expect(host.querySelector('[name="payer"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('[role="radio"]')).map((b) => b.textContent)).toEqual(["Equal", "Exact"]);
    expect(host.textContent).not.toMatch(/percent|shares|itemi|Spliteco/i);
  });

  it("shows the group's one currency and switches it with the group", () => {
    mount();
    expect(q('[name="group"]').textContent).toContain("Flat 4B · INR");
    expect(host.textContent).toContain("₹");
    type(q<HTMLSelectElement>('[name="group"]'), "org_trip");
    expect(host.textContent).toContain("$");
    expect(host.querySelectorAll("[data-person]")).toHaveLength(2);
  });

  it("Equal shows remainder-rounded shares and Save sends them", async () => {
    const { createExpense, onSaved, onClose } = mount();
    expect(save().disabled).toBe(true);
    type(q('[name="amount"]'), "100");
    type(q('[name="description"]'), "Dinner");
    expect(Array.from(host.querySelectorAll("[data-share]")).map((s) => s.textContent)).toEqual(["₹33.34", "₹33.33", "₹33.33"]);
    expect(save().disabled).toBe(false);
    await act(async () => { click(save()); });
    expect(createExpense).toHaveBeenCalledWith("org_flat", { title: "Dinner", totalMinor: 10000, currency: "INR", payers: [{ subjectId: "usr_me", amountMinor: 10000 }], split: { method: "equal", participants: ["usr_me", "usr_a", "usr_b"] } });
    expect(onSaved).toHaveBeenCalledWith("org_flat", {});
    expect(onClose).toHaveBeenCalled();
  });

  it("Exact blocks Save and says so until the shares add up", async () => {
    const { createExpense } = mount();
    type(q('[name="amount"]'), "100");
    type(q('[name="description"]'), "Rent");
    click(q('[data-method="exact"]'));
    type(q('[aria-label="You share"]'), "40");
    type(q('[aria-label="Asha share"]'), "30");
    expect(q("[data-gap]").textContent).toBe("₹30 left");
    expect(save().disabled).toBe(true);
    type(q('[aria-label="Ben share"]'), "40");
    expect(q("[data-gap]").textContent).toBe("₹10 over");
    expect(save().disabled).toBe(true);
    type(q('[aria-label="Ben share"]'), "30");
    expect(host.querySelector("[data-gap]")).toBeNull();
    expect(save().disabled).toBe(false);
    await act(async () => { click(save()); });
    expect(createExpense).toHaveBeenCalledWith("org_flat", expect.objectContaining({ split: { method: "exact", participants: [{ subjectId: "usr_me", amountMinor: 4000 }, { subjectId: "usr_a", amountMinor: 3000 }, { subjectId: "usr_b", amountMinor: 3000 }] } }));
  });

  it("a failed save stays open and says so", async () => {
    const { onClose } = mount({ createExpense: async () => { throw new Error("no"); } });
    type(q('[name="amount"]'), "10");
    type(q('[name="description"]'), "x");
    await act(async () => { click(save()); });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["cookpool", "spliteco"] as const)("%s: tokens only, the theme's colours are set", (theme) => {
    mount({ theme });
    const html = host.innerHTML;
    expect(html).toContain(`--look-primary: ${lookColours(theme).primary}`);
    expect(html.replace(/--look-[a-zA-Z]+: #[0-9a-fA-F]{6}/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("ExpenseButton", () => {
  it("opens from the floating button and closing without saving sends nothing", () => {
    const createExpense = jest.fn(async () => ({}));
    act(() => root.render(<ExpenseButton theme="spliteco" groups={groups} me="usr_me" createExpense={createExpense} contained reduceMotion />));
    const launcher = q<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    expect(launcher.getAttribute("aria-label")).toBe("Expense");
    click(launcher);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    type(q('[name="amount"]'), "50");
    type(q('[name="description"]'), "Tea");
    click(q('button[aria-label="Close"]'));
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    expect(createExpense).not.toHaveBeenCalled();
  });
});
