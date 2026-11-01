import { buildExpense } from "@saas/kitchen-engine/ledger";
import type { CreateExpenseRequest } from "@saas/contracts/kitchen";
import {
  MAX_SHARES,
  SPLIT_MODE_OPTIONS,
  firstExpenseError,
  initialExpenseForm,
  previewExpense,
  stepShares,
  toggleEveryone,
  type ExpenseForm,
} from "@web-console-next/components/kitchen/expense-form";

const ME = "usr_a";
const B = "usr_b";
const C = "usr_c";
const PEOPLE = [ME, B, C];

function form(patch: Partial<ExpenseForm> = {}): ExpenseForm {
  return { ...initialExpenseForm(PEOPLE, ME), title: "Groceries", amount: "100", ...patch };
}

/**
 * What each person owes for this request on the server: the engine's
 * buildExpense, as kitchen-worker runs it (people who owe nothing left out).
 */
function serverOwed(request: CreateExpenseRequest): Record<string, number> {
  const splits = buildExpense({
    totalMinor: request.totalMinor,
    payers: request.payers,
    mode: request.mode,
    participants: request.participants,
  });
  return Object.fromEntries(splits.filter((s) => s.owedMinor > 0).map((s) => [s.subjectId, s.owedMinor]));
}

/** What the form previews each person owing (people who owe nothing left out). */
function previewOwed(f: ExpenseForm): Record<string, number> {
  const p = previewExpense(f, PEOPLE);
  return Object.fromEntries(
    p.people.filter((x) => (x.owedMinor ?? 0) > 0).map((x) => [x.subjectId, x.owedMinor!]),
  );
}

describe("a new expense form (CP-8)", () => {
  it("starts with you paying, split equally between everyone, one share each", () => {
    const f = initialExpenseForm(PEOPLE, ME);
    expect(f.payerId).toBe(ME);
    expect(f.severalPayers).toBe(false);
    expect(f.mode).toBe("equal");
    expect(f.included).toEqual({ [ME]: true, [B]: true, [C]: true });
    expect(f.shares).toEqual({ [ME]: 1, [B]: 1, [C]: 1 });
  });

  it("falls back to the first person when you aren't in the list", () => {
    expect(initialExpenseForm([B, C], ME).payerId).toBe(B);
    expect(initialExpenseForm([], ME).payerId).toBeNull();
  });

  it("offers the four modes, in order", () => {
    expect(SPLIT_MODE_OPTIONS.map((m) => m.label)).toEqual(["Equally", "Exact", "%", "Shares"]);
    expect(SPLIT_MODE_OPTIONS.map((m) => m.id)).toEqual(["equal", "exact", "percent", "shares"]);
  });
});

describe("Equally", () => {
  it("splits with largest remainder (odd paisa to the first listed) and posts no values", () => {
    const p = previewExpense(form({ amount: "100" }), PEOPLE);
    expect(p.people.map((x) => x.owedMinor)).toEqual([3334, 3333, 3333]);
    expect(p.split).toEqual({ assignedMinor: 10_000, totalMinor: 10_000, ok: true, text: "₹100.00 of ₹100.00 assigned" });
    expect(p.request).toEqual({
      title: "Groceries",
      totalMinor: 10_000,
      currency: "INR",
      payers: [{ subjectId: ME, amountMinor: 10_000 }],
      mode: "equal",
      participants: [{ subjectId: ME }, { subjectId: B }, { subjectId: C }],
    });
    expect(previewOwed(form({ amount: "100" }))).toEqual(serverOwed(p.request!));
  });

  it("leaves out whoever is unticked, at ₹0", () => {
    const p = previewExpense(form({ amount: "0.05", included: { [ME]: true, [B]: false, [C]: true } }), PEOPLE);
    expect(p.people.map((x) => [x.inSplit, x.owedMinor])).toEqual([
      [true, 3],
      [false, 0],
      [true, 2],
    ]);
    expect(p.request?.participants).toEqual([{ subjectId: ME }, { subjectId: C }]);
  });

  it("refuses nobody", () => {
    const p = previewExpense(form({ included: {} }), PEOPLE);
    expect(p.errors.split).toBe("Pick at least one person to share it");
    expect(p.split).toMatchObject({ assignedMinor: 0, ok: false, text: "₹0.00 of ₹100.00 assigned" });
    expect(p.request).toBeNull();
  });

  it("Everyone / No one toggles the lot", () => {
    const none = toggleEveryone(form(), PEOPLE);
    expect(Object.values(none.included).every((v) => !v)).toBe(true);
    const all = toggleEveryone(none, PEOPLE);
    expect(Object.values(all.included).every(Boolean)).toBe(true);
  });
});

describe("Exact", () => {
  it("shows what is still to assign, in red, until the amounts add up", () => {
    const p = previewExpense(form({ mode: "exact", exact: { [ME]: "40", [B]: "35.50" } }), PEOPLE);
    expect(p.people.map((x) => x.owedMinor)).toEqual([4000, 3550, 0]);
    expect(p.split).toMatchObject({ assignedMinor: 7550, ok: false, text: "₹75.50 of ₹100.00 assigned" });
    expect(p.errors.split).toBe("The amounts must add up to the total: ₹24.50 still to assign");
    expect(p.request).toBeNull();
  });

  it("says by how much it is over", () => {
    const p = previewExpense(form({ mode: "exact", exact: { [ME]: "80", [B]: "30" } }), PEOPLE);
    expect(p.split?.ok).toBe(false);
    expect(p.errors.split).toBe("The amounts must add up to the total: ₹10.00 more than the total");
  });

  it("posts each non-zero amount in minor units once they add up", () => {
    const f = form({ mode: "exact", exact: { [ME]: "40", [B]: "35.50", [C]: "24.50" } });
    const p = previewExpense(f, PEOPLE);
    expect(p.split).toMatchObject({ ok: true, text: "₹100.00 of ₹100.00 assigned" });
    expect(p.request?.participants).toEqual([
      { subjectId: ME, value: 4000 },
      { subjectId: B, value: 3550 },
      { subjectId: C, value: 2450 },
    ]);
    expect(previewOwed(f)).toEqual(serverOwed(p.request!));
  });

  it("flags an amount that isn't one, on that person", () => {
    const p = previewExpense(form({ mode: "exact", exact: { [ME]: "40", [B]: "abc" } }), PEOPLE);
    expect(p.people[1]!.error).toBe("Enter an amount like 250 or 249.50");
    expect(p.errors.split).toBe("Check the amounts");
    expect(p.request).toBeNull();
  });
});

describe("%", () => {
  it("refuses percentages that don't make 100, and shows each part rounded down meanwhile", () => {
    const p = previewExpense(form({ mode: "percent", percent: { [ME]: "50", [B]: "30" } }), PEOPLE);
    expect(p.errors.split).toBe("The percentages must add up to 100% (now 80%)");
    expect(p.percentText).toBe("80%");
    expect(p.people.map((x) => x.owedMinor)).toEqual([5000, 3000, 0]);
    expect(p.split).toMatchObject({ assignedMinor: 8000, ok: false, text: "₹80.00 of ₹100.00 assigned" });
    expect(p.request).toBeNull();
  });

  it("splits with the engine once they make 100, sending two-decimal percentages", () => {
    const f = form({ amount: "10.01", mode: "percent", percent: { [ME]: "33.33", [B]: "33.33", [C]: "33.34" } });
    const p = previewExpense(f, PEOPLE);
    expect(p.split).toMatchObject({ ok: true, assignedMinor: 1001, totalMinor: 1001 });
    expect(p.request?.participants).toEqual([
      { subjectId: ME, value: 33.33 },
      { subjectId: B, value: 33.33 },
      { subjectId: C, value: 33.34 },
    ]);
    const owed = p.people.map((x) => x.owedMinor!);
    expect(owed.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(previewOwed(f)).toEqual(serverOwed(p.request!));
  });

  it("flags a percentage that isn't one", () => {
    const p = previewExpense(form({ mode: "percent", percent: { [ME]: "101" } }), PEOPLE);
    expect(p.people[0]!.error).toBe("Enter a percentage like 25 or 33.33");
    expect(p.errors.split).toBe("Check the percentages");
  });
});

describe("Shares", () => {
  it("weights by the steppers; nobody at 0 is in the split", () => {
    const f = form({ amount: "10", mode: "shares", shares: { [ME]: 2, [B]: 1, [C]: 0 } });
    const p = previewExpense(f, PEOPLE);
    expect(p.people.map((x) => [x.inSplit, x.owedMinor])).toEqual([
      [true, 667],
      [true, 333],
      [false, 0],
    ]);
    expect(p.request?.participants).toEqual([
      { subjectId: ME, value: 2 },
      { subjectId: B, value: 1 },
    ]);
    expect(previewOwed(f)).toEqual(serverOwed(p.request!));
  });

  it("needs someone to have a share", () => {
    const p = previewExpense(form({ mode: "shares", shares: {} }), PEOPLE);
    expect(p.errors.split).toBe("Give at least one person a share");
    expect(p.request).toBeNull();
  });

  it("steps within 0–99", () => {
    let f = form();
    f = stepShares(f, B, -1);
    f = stepShares(f, B, -1);
    expect(f.shares[B]).toBe(0);
    for (let i = 0; i < 120; i++) f = stepShares(f, C, 1);
    expect(f.shares[C]).toBe(MAX_SHARES);
  });
});

describe("who paid", () => {
  it("several payers must add up to the total", () => {
    const short = previewExpense(form({ severalPayers: true, payerAmounts: { [ME]: "60", [B]: "30" } }), PEOPLE);
    expect(short.paid).toMatchObject({ ok: false, text: "₹90.00 of ₹100.00 paid" });
    expect(short.errors.payers).toBe("What people paid must add up to the total: ₹10.00 still to assign");
    expect(short.request).toBeNull();

    const ok = previewExpense(form({ severalPayers: true, payerAmounts: { [ME]: "60", [B]: "40", [C]: "" } }), PEOPLE);
    expect(ok.paid).toMatchObject({ ok: true, text: "₹100.00 of ₹100.00 paid" });
    expect(ok.request?.payers).toEqual([
      { subjectId: ME, amountMinor: 6000 },
      { subjectId: B, amountMinor: 4000 },
    ]);
    expect(serverOwed(ok.request!)).toEqual({ [ME]: 3334, [B]: 3333, [C]: 3333 });
  });

  it("flags a payer's amount that isn't one, and needs at least one", () => {
    const bad = previewExpense(form({ severalPayers: true, payerAmounts: { [B]: "x" } }), PEOPLE);
    expect(bad.payerErrors[B]).toBe("Enter an amount like 250 or 249.50");
    expect(bad.errors.payers).toBe("Check the amounts paid");
    const none = previewExpense(form({ severalPayers: true }), PEOPLE);
    expect(none.errors.payers).toBe("Enter what each person paid");
  });

  it("one payer must be someone in the group", () => {
    expect(previewExpense(form({ payerId: null }), PEOPLE).errors.payers).toBe("Pick who paid");
    expect(previewExpense(form({ payerId: "usr_gone" }), PEOPLE).errors.payers).toBe("Pick who paid");
  });
});

describe("what for and how much", () => {
  it("needs a title and a positive amount", () => {
    const p = previewExpense(form({ title: "  ", amount: "" }), PEOPLE);
    expect(p.errors.title).toBe("Say what it was for");
    expect(p.errors.amount).toBe("Enter the amount");
    expect(p.split).toBeNull();
    expect(p.people.every((x) => x.owedMinor === null)).toBe(true);
    expect(previewExpense(form({ amount: "0" }), PEOPLE).errors.amount).toBe("The amount must be more than zero");
    expect(previewExpense(form({ amount: "12.345" }), PEOPLE).errors.amount).toBe("Use at most two decimal places");
    expect(previewExpense(form({ title: "x".repeat(201) }), PEOPLE).errors.title).toBe("Keep it under 200 characters");
  });

  it("trims the title it posts and counts in the group's currency", () => {
    const p = previewExpense(form({ title: "  Gas cylinder " }), PEOPLE, "USD");
    expect(p.request).toMatchObject({ title: "Gas cylinder", currency: "USD" });
    expect(p.split?.text).toBe("$100.00 of $100.00 assigned");
  });

  it("points at the first problem in the form's order", () => {
    expect(firstExpenseError({ split: "x", amount: "y" })).toBe("amount");
    expect(firstExpenseError({ payers: "x" })).toBe("payers");
    expect(firstExpenseError({})).toBeNull();
  });
});

describe("the preview rounds exactly as the server", () => {
  // A small deterministic generator: the same cases on every run.
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };

  it("for many totals in every mode", () => {
    for (let i = 0; i < 300; i++) {
      const totalMinor = 1 + rand(500_000);
      const amount = `${Math.floor(totalMinor / 100)}.${String(totalMinor % 100).padStart(2, "0")}`;
      const mode = (["equal", "percent", "shares"] as const)[i % 3]!;
      let f = form({ amount, mode });
      if (mode === "equal") f = { ...f, included: { [ME]: rand(2) === 0, [B]: true, [C]: rand(2) === 0 } };
      if (mode === "shares") f = { ...f, shares: { [ME]: rand(4), [B]: 1 + rand(3), [C]: rand(5) } };
      if (mode === "percent") {
        const a = rand(10_001);
        const b = rand(10_001 - a);
        const c = 10_000 - a - b;
        const pct = (h: number) => `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`;
        f = { ...f, percent: { [ME]: pct(a), [B]: pct(b), [C]: pct(c) } };
      }
      const p = previewExpense(f, PEOPLE);
      expect(p.request).not.toBeNull();
      expect(previewOwed(f)).toEqual(serverOwed(p.request!));
      expect(p.people.reduce((s, x) => s + (x.owedMinor ?? 0), 0)).toBe(totalMinor);
    }
  });
});
