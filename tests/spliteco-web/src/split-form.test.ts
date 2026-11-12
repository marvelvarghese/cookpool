import { buildSplitecoSplits } from "@saas/kitchen-engine/splits";
import {
  adjustmentAmount,
  buildRequest,
  enteredItems,
  formFromInput,
  switchFromItems,
  newForm,
  parsePct,
  payersStatus,
  splitStatus,
  toSpec,
  totalOf,
  type ExpenseForm,
} from "@/lib/split-form";

// The Add expense form → the request Save sends, for all six splits, and the
// "adds up" gate: Save is only on when the engine spliteco-worker uses agrees.

const ME = "usr_me";
const ANU = "usr_anu";
const DEV = "usr_dev";
const MEERA = "usr_meera";
const PEOPLE = [ME, ANU, DEV, MEERA];

function form(over: Partial<ExpenseForm> = {}): ExpenseForm {
  return { ...newForm(PEOPLE, ME), title: "Villa, 3 nights", amountText: "18,000", occurredOn: "2026-11-08", ...over };
}

function ok(f: ExpenseForm) {
  const r = buildRequest(f, "INR");
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.problems)}`);
  // What the server will do with it adds up to the paisa.
  const built = buildSplitecoSplits(r.request.totalMinor, r.request.payers, toSpec(r.request.split));
  expect(built.ok).toBe(true);
  return r.request;
}

describe("a fresh form", () => {
  it("starts with the caller paying and everyone sharing equally", () => {
    const f = newForm(PEOPLE, ME);
    expect(f.payer).toBe(ME);
    expect(f.method).toBe("equal");
    expect(Object.values(f.equal).every(Boolean)).toBe(true);
  });

  it("keeps Save off without a title or an amount", () => {
    const r = buildRequest(newForm(PEOPLE, ME));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.kind)).toEqual(["no_title", "no_amount"]);
  });
});

describe("the six methods", () => {
  it("equal: only the ticked people", () => {
    const r = ok(form({ equal: { [ME]: true, [ANU]: true, [DEV]: false, [MEERA]: true } }));
    expect(r.split).toEqual({ method: "equal", participants: [ME, ANU, MEERA] });
    expect(r.totalMinor).toBe(1_800_000);
    expect(r.payers).toEqual([{ subjectId: ME, amountMinor: 1_800_000 }]);
    expect(r.currency).toBe("INR");
    expect(r.occurredAt).toBe("2026-11-08T12:00:00.000Z");
    expect(r.category).toBe("stay");
  });

  it("exact: amounts that add up; off while they don't", () => {
    const f = form({ method: "exact", exact: { [ME]: "4,500", [ANU]: "4500", [DEV]: "3000", [MEERA]: "5,000" } });
    expect(buildRequest(f).ok).toBe(false);
    expect(splitStatus(f)).toMatchObject({ kind: "left", assignedMinor: 1_700_000, ok: false });
    f.exact[MEERA] = "6000";
    const r = ok(f);
    expect(r.split).toEqual({
      method: "exact",
      participants: [
        { subjectId: ME, amountMinor: 450_000 },
        { subjectId: ANU, amountMinor: 450_000 },
        { subjectId: DEV, amountMinor: 300_000 },
        { subjectId: MEERA, amountMinor: 600_000 },
      ],
    });
  });

  it("pct: basis points that reach 100%", () => {
    const f = form({ method: "pct", pct: { [ME]: "25", [ANU]: "25", [DEV]: "20", [MEERA]: "20" } });
    expect(splitStatus(f)).toMatchObject({ kind: "pct", basisPoints: 9000, ok: false });
    f.pct[MEERA] = "30";
    expect(ok(f).split).toEqual({
      method: "pct",
      participants: [
        { subjectId: ME, basisPoints: 2500 },
        { subjectId: ANU, basisPoints: 2500 },
        { subjectId: DEV, basisPoints: 2000 },
        { subjectId: MEERA, basisPoints: 3000 },
      ],
    });
  });

  it("shares: people on zero shares are left out", () => {
    const r = ok(form({ method: "shares", shares: { [ME]: 1, [ANU]: 1, [DEV]: 0, [MEERA]: 2 } }));
    expect(r.split).toEqual({
      method: "shares",
      participants: [
        { subjectId: ME, shares: 1 },
        { subjectId: ANU, shares: 1 },
        { subjectId: MEERA, shares: 2 },
      ],
    });
  });

  it("adjust: + and − on top of equal, blanks as 0", () => {
    const r = ok(form({ method: "adjust", adjust: { [ME]: "", [ANU]: "", [DEV]: "-200", [MEERA]: "+1,200" } }));
    expect(r.split).toEqual({
      method: "adjust",
      participants: [
        { subjectId: ME, adjustMinor: 0 },
        { subjectId: ANU, adjustMinor: 0 },
        { subjectId: DEV, adjustMinor: -20_000 },
        { subjectId: MEERA, adjustMinor: 120_000 },
      ],
    });
  });

  it("items: portions, % and exact, plus tax and a discount; the total comes from the bill", () => {
    const f = form({
      method: "items",
      amountText: "",
      items: [
        { key: "a", name: "Fish thali", qtyText: "2", unitText: "420", totalText: "", shares: { [ME]: { mode: "portion", value: 1000 }, [DEV]: { mode: "portion", value: 1000 } } },
        { key: "b", name: "Chicken xacuti", qtyText: "1", unitText: "", totalText: "560", shares: { [ME]: { mode: "portion", value: 333 }, [ANU]: { mode: "pct", value: 5000 }, [DEV]: { mode: "portion", value: 667 } } },
        { key: "c", name: "Bebinca", qtyText: "1", unitText: "", totalText: "320", shares: { [MEERA]: { mode: "exact", value: 12_000 }, [ANU]: { mode: "portion", value: 1000 } } },
      ],
      adjustments: [
        { key: "t", kind: "tax", label: "", mode: "pct", valueText: "5" },
        { key: "d", kind: "discount", label: "Happy hour", mode: "amount", valueText: "100" },
      ],
    });
    // 840 + 560 + 320 = 1,720; GST 5% = 86; less 100 → 1,706.
    expect(totalOf(f)).toBe(170_600);
    const r = ok(f);
    expect(r.totalMinor).toBe(170_600);
    expect(r.split).toEqual({
      method: "items",
      items: [
        { name: "Fish thali", qty: 2, unitMinor: 42_000, totalMinor: 84_000, shares: [{ subjectId: ME, mode: "portion", value: 1000 }, { subjectId: DEV, mode: "portion", value: 1000 }] },
        {
          name: "Chicken xacuti",
          qty: 1,
          unitMinor: null,
          totalMinor: 56_000,
          shares: [{ subjectId: ME, mode: "portion", value: 333 }, { subjectId: ANU, mode: "pct", value: 5000 }, { subjectId: DEV, mode: "portion", value: 667 }],
        },
        { name: "Bebinca", qty: 1, unitMinor: null, totalMinor: 32_000, shares: [{ subjectId: ANU, mode: "portion", value: 1000 }, { subjectId: MEERA, mode: "exact", value: 12_000 }] },
      ],
      adjustments: [
        { kind: "tax", label: "Tax 5%", amountMinor: 8_600 },
        { kind: "discount", label: "Happy hour", amountMinor: 10_000 },
      ],
    });
  });

  it("items: Save stays off while an item has money nobody takes", () => {
    const f = form({
      method: "items",
      items: [{ key: "a", name: "Prawn curry", qtyText: "1", unitText: "", totalText: "680", shares: { [ME]: { mode: "exact", value: 30_000 } } }],
    });
    const r = buildRequest(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContainEqual({ kind: "item_unassigned", item: 0, amountMinor: 38_000 });
    expect(splitStatus(f)).toMatchObject({ ok: false, kind: "left", assignedMinor: 30_000 });
  });

  it("items: more assigned than an item costs is refused", () => {
    const f = form({
      method: "items",
      items: [{ key: "a", name: "Beer", qtyText: "1", unitText: "", totalText: "100", shares: { [ME]: { mode: "pct", value: 6000 }, [ANU]: { mode: "pct", value: 6000 } } }],
    });
    expect(splitStatus(f)).toMatchObject({ ok: false, kind: "over" });
  });
});

describe("who paid", () => {
  it("several people must add up to the total", () => {
    const f = form({ payerMode: "many", payerAmounts: { [ME]: "12000", [ANU]: "5000", [DEV]: "", [MEERA]: "" } });
    expect(payersStatus(f)).toEqual({ totalMinor: 1_800_000, paidMinor: 1_700_000, ok: false });
    expect(buildRequest(f).ok).toBe(false);
    f.payerAmounts[ANU] = "6000";
    expect(payersStatus(f).ok).toBe(true);
    expect(ok(f).payers).toEqual([
      { subjectId: ME, amountMinor: 1_200_000 },
      { subjectId: ANU, amountMinor: 600_000 },
    ]);
  });
});

describe("percent and tax helpers", () => {
  it("parses percentages to basis points", () => {
    expect(parsePct("25")).toBe(2500);
    expect(parsePct("33.33")).toBe(3333);
    expect(parsePct("12.5%")).toBe(1250);
    expect(parsePct("101")).toBeNull();
    expect(parsePct("abc")).toBeNull();
  });

  it("rounds a percentage of the subtotal to the paisa", () => {
    expect(adjustmentAmount({ key: "x", kind: "tax", label: "", mode: "pct", valueText: "5" }, 384_000)).toBe(19_200);
    expect(adjustmentAmount({ key: "x", kind: "service", label: "", mode: "pct", valueText: "12.5" }, 333)).toBe(42);
    expect(adjustmentAmount({ key: "x", kind: "discount", label: "", mode: "amount", valueText: "50" }, 0)).toBe(5000);
  });
});

describe("an edit starts from what was saved", () => {
  it.each([
    ["equal", form({ equal: { [ME]: true, [ANU]: false, [DEV]: true, [MEERA]: true } })],
    ["exact", form({ method: "exact", exact: { [ME]: "4500", [ANU]: "4500", [DEV]: "3000", [MEERA]: "6000" } })],
    ["pct", form({ method: "pct", pct: { [ME]: "33.34", [ANU]: "33.33", [DEV]: "33.33", [MEERA]: "" } })],
    ["shares", form({ method: "shares", shares: { [ME]: 2, [ANU]: 1, [DEV]: 1, [MEERA]: 0 } })],
    ["adjust", form({ method: "adjust", adjust: { [ME]: "500", [ANU]: "-500", [DEV]: "", [MEERA]: "" } })],
    ["several payers", form({ payerMode: "many", payerAmounts: { [ME]: "9000", [ANU]: "9000", [DEV]: "", [MEERA]: "" } })],
  ])("%s round-trips", (_name, f) => {
    const first = ok(f);
    const again = ok(formFromInput(first, PEOPLE, ME));
    expect(again).toEqual(first);
  });

  it("items round-trip with their adjustments as amounts", () => {
    const f = form({
      method: "items",
      items: [{ key: "a", name: "Naan", qtyText: "4", unitText: "90", totalText: "", shares: { [ME]: { mode: "portion", value: 1000 }, [ANU]: { mode: "portion", value: 3000 } } }],
      adjustments: [{ key: "t", kind: "service", label: "Service 10%", mode: "pct", valueText: "10" }],
    });
    const first = ok(f);
    expect(ok(formFromInput(first, PEOPLE, ME))).toEqual(first);
  });
});

describe("leaving Itemized", () => {
  const itemized = () =>
    form({
      method: "items",
      amountText: "",
      items: [{ key: "a", name: "Prawn curry", qtyText: "1", unitText: "", totalText: "680", shares: { [ME]: { mode: "portion", value: 1000 } } }],
      adjustments: [{ key: "t", kind: "tax", label: "", mode: "pct", valueText: "5" }],
    });

  it("choose Itemized, add an item, switch to Equal → an equal split with no items, the bill total kept", () => {
    const f = itemized();
    expect(enteredItems(f)).toBe(1);
    const back = switchFromItems(f, "equal");
    expect(back.items).toEqual([]);
    expect(back.adjustments).toEqual([]);
    const r = ok(back);
    expect(r.split).toEqual({ method: "equal", participants: PEOPLE });
    expect(r.split).not.toHaveProperty("items");
    expect(r.totalMinor).toBe(71_400); // 680 + GST 5%
    expect(r.payers).toEqual([{ subjectId: ME, amountMinor: 71_400 }]);
  });

  it("the Split tabs keep the items, unused, in case you come back", () => {
    const back = switchFromItems(itemized(), "shares", false);
    expect(back.items).toHaveLength(1);
    expect(ok(back).split.method).toBe("shares");
  });

  it("an empty item is not counted as entered", () => {
    expect(enteredItems(form({ method: "items", items: [{ key: "x", name: " ", qtyText: "1", unitText: "", totalText: "", shares: {} }] }))).toBe(0);
  });
});
