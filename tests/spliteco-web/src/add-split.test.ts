import { readFileSync } from "node:fs";
import {
  AMOUNT,
  METHODS,
  amountShown,
  chooseMethod,
  footerOf,
  keyFromKeyboard,
  keypadKeys,
  keypadLive,
  payerChip,
  pressKey,
  rowsOf,
  saveLabel,
  selectionFor,
  stepShares,
  stripRelease,
  toggleIn,
  typeInto,
  type Key,
  type Selected,
} from "@/lib/add-split";
import { buildRequest, newForm, type ExpenseForm } from "@/lib/split-form";
import { setShare } from "@/lib/itemized";
import type { Names } from "@/lib/people";

// spliteco-calm SL4 (design §4): Add is keypad first. Every method shows each
// person's control and a footer that says what is left; Save says what is
// missing; the one keypad types into the amount or the selected person.

const ME = "usr_me";
const ANU = "usr_anu";
const DEV = "usr_dev";
const MEERA = "usr_meera";
const PEOPLE = [ME, ANU, DEV, MEERA];
const NAMES: Names = new Map<string, string | null>([
  [ANU, "Anu"],
  [DEV, "Dev"],
  [MEERA, "Meera"],
]);

function form(over: Partial<ExpenseForm> = {}): ExpenseForm {
  return { ...newForm(PEOPLE, ME), title: "Scooter rent", amountText: "2400", occurredOn: "2026-11-08", ...over };
}
const foot = (f: ExpenseForm) => footerOf(f, NAMES, ME);
const label = (f: ExpenseForm) => saveLabel(f, buildRequest(f, "INR"), NAMES, ME);

/** Press keys in order into what `sel` selects. */
function type(f: ExpenseForm, sel: Selected, keys: string): ExpenseForm {
  for (const k of keys.split(" ")) f = pressKey(f, sel, k as Key);
  return f;
}
const person = (id: string): Selected => ({ kind: "person", id });

describe("each method's footer and Save", () => {
  it("Equally: n of N in, the share each, Save", () => {
    const f = form();
    expect(foot(f)).toEqual({ left: "4 of 4 in", right: "₹600 each", ok: true });
    expect(label(f)).toBe("Save");
    const three = toggleIn(f, DEV);
    expect(foot(three)).toEqual({ left: "3 of 4 in", right: "₹800 each", ok: true });
    const none = PEOPLE.reduce((g, id) => toggleIn(g, id), f);
    expect(foot(none)).toEqual({ left: "0 of 4 in", right: "Pick someone", ok: false });
    expect(label(none)).toBe("Pick someone");
  });

  it("Exact ₹: what is assigned of the total, then left / over / Adds up ✓", () => {
    const f = form({ method: "exact", exact: { [ME]: "600", [ANU]: "600", [DEV]: "", [MEERA]: "" } });
    expect(foot(f)).toEqual({ left: "₹1,200 of ₹2,400", right: "₹1,200 left", ok: false });
    expect(label(f)).toBe("₹1,200 left");
    const over = { ...f, exact: { ...f.exact, [DEV]: "1400" } };
    expect(foot(over).right).toBe("₹200 over");
    expect(label(over)).toBe("₹200 over");
    const even = { ...f, exact: { ...f.exact, [DEV]: "600", [MEERA]: "600" } };
    expect(foot(even)).toEqual({ left: "₹2,400 of ₹2,400", right: "Adds up ✓", ok: true });
    expect(label(even)).toBe("Save");
  });

  it("Percent: the % assigned of 100%, then % left / over", () => {
    const f = form({ method: "pct", pct: { [ME]: "40", [ANU]: "20", [DEV]: "20", [MEERA]: "" } });
    expect(foot(f)).toEqual({ left: "80% of 100%", right: "20% left", ok: false });
    expect(label(f)).toBe("20% left");
    expect(foot({ ...f, pct: { ...f.pct, [MEERA]: "25.5" } }).right).toBe("5.5% over");
    const full = { ...f, pct: { ...f.pct, [MEERA]: "20" } };
    expect(foot(full)).toEqual({ left: "100% of 100%", right: "Adds up ✓", ok: true });
    expect(label(full)).toBe("Save");
    // Each row shows the ₹ its % comes to.
    expect(rowsOf(f, NAMES, ME).map((r) => [r.field, r.post, r.comes])).toEqual([
      ["40", "%", "₹960"],
      ["20", "%", "₹480"],
      ["20", "%", "₹480"],
      ["0", "%", "₹0"],
    ]);
  });

  it("Shares: how many shares, and what one share is", () => {
    const f = form({ method: "shares", shares: { [ME]: 2, [ANU]: 1, [DEV]: 1, [MEERA]: 1 } });
    expect(foot(f)).toEqual({ left: "5 shares", right: "₹480 a share", ok: true });
    expect(rowsOf(f, NAMES, ME).map((r) => [r.shares, r.comes])).toEqual([
      [2, "₹960"],
      [1, "₹480"],
      [1, "₹480"],
      [1, "₹480"],
    ]);
    const none = PEOPLE.reduce((g, id) => stepShares(stepShares(g, id, -1), id, -1), f);
    expect(foot(none)).toEqual({ left: "0 shares", right: "Add a share", ok: false });
    expect(label(none)).toBe("Add a share");
    expect(stepShares(f, ME, 200).shares[ME]).toBe(99);
  });

  it("+ / −: the equal base, then ±; refuses anyone below ₹0", () => {
    const f = form({ method: "adjust", adjust: { [ME]: "", [ANU]: "", [DEV]: "+200", [MEERA]: "-100" } });
    expect(foot(f)).toEqual({ left: "₹575 each, then ±", right: "Adds up ✓", ok: true });
    expect(rowsOf(f, NAMES, ME).map((r) => [r.field, r.tone, r.comes])).toEqual([
      ["±0", "plain", "₹575"],
      ["±0", "plain", "₹575"],
      ["+₹200", "get", "₹775"],
      ["−₹100", "owe", "₹475"],
    ]);
    const below = { ...f, adjust: { ...f.adjust, [MEERA]: "-800" } };
    expect(foot(below)).toMatchObject({ right: "Someone is below ₹0", ok: false });
    expect(label(below)).toBe("Someone is below ₹0");
  });

  it("no amount: every method says to type it", () => {
    for (const method of ["equal", "exact", "pct", "shares", "adjust"] as const) {
      const f = form({ method, amountText: "" });
      expect([method, foot(f).right, label(f)]).toEqual([method, "Type the amount", "Type the amount"]);
    }
  });

  it("the title is asked for once the split adds up", () => {
    expect(label(form({ title: "" }))).toBe("Say what it was for");
  });

  it("Itemized: Save says how many items are left", () => {
    let f = chooseMethod(form(), "items");
    expect(f.items).toHaveLength(1);
    expect(label(f)).toBe("1 item left to assign");
    f = { ...f, items: [...f.items, { ...f.items[0]!, key: "b", name: "Fries", totalText: "300" }] };
    expect(label(f)).toBe("2 items left to assign");
    f = { ...f, items: f.items.map((it) => setShare(it, ME, { mode: "portion", value: 1000 })) };
    expect(label(f)).toBe("Save");
    expect(foot(f).ok).toBe(true);
  });

  it("several payers: the chip counts them", () => {
    const f = form({ payerMode: "many", payerAmounts: { [ME]: "1200", [ANU]: "1200", [DEV]: "", [MEERA]: "" } });
    expect(payerChip(f, NAMES, ME)).toBe("2 people paid");
    expect(payerChip(form(), NAMES, ME)).toBe("You paid");
    expect(payerChip(form({ payer: MEERA }), NAMES, ME)).toBe("Meera paid");
  });
});

describe("the one keypad", () => {
  it("types into the amount: 2-decimal limit, one point, ⌫, a lone 0 replaced", () => {
    let f = form({ amountText: "" });
    f = type(f, AMOUNT, "0 2 4 0 0 . 5 0 7");
    expect(f.amountText).toBe("2400.50");
    expect(amountShown(f.amountText)).toBe("2,400.50");
    f = type(f, AMOUNT, ". del del del");
    expect(f.amountText).toBe("2400");
    expect(typeInto("", ".", "money")).toBe("0.");
    expect(typeInto("1234567", "8", "money")).toBe("1234567");
    expect(amountShown("")).toBe("0");
  });

  it("types into the selected person, not the amount", () => {
    let f = form({ method: "exact" });
    f = type(f, person(ANU), "6 0 0");
    expect(f.exact[ANU]).toBe("600");
    expect(f.amountText).toBe("2400");
    f = type(f, person(ANU), ". 2 5 9");
    expect(f.exact[ANU]).toBe("600.25");
  });

  it("Percent: at most 3 digits and 2 decimals", () => {
    const f = type(form({ method: "pct" }), person(ME), "1 0 0 0 . 5 5 5");
    expect(f.pct[ME]).toBe("100.55");
  });

  it("+ / −: the point key is ±; a digit with no sign is +", () => {
    const f = form({ method: "adjust" });
    expect(keypadKeys(f, person(ME)).map((k) => k.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", "⌫"]);
    expect(keypadKeys(f, AMOUNT)[9]!.label).toBe(".");
    let g = type(f, person(DEV), "2 0 0");
    expect(g.adjust[DEV]).toBe("+200");
    g = type(g, person(DEV), "±");
    expect(g.adjust[DEV]).toBe("-200");
    g = type(g, person(MEERA), "± 1 0 0");
    expect(g.adjust[MEERA]).toBe("-100");
    // A lone sign is nothing yet: it still adds up.
    const lone = type(f, person(ANU), "±");
    expect(lone.adjust[ANU]).toBe("-");
    expect(buildRequest(lone).ok).toBe(true);
    expect(type(g, person(DEV), "del del del").adjust[DEV]).toBe("");
  });

  it("choosing Exact, Percent or + / − selects the first person; the rest the amount", () => {
    expect(selectionFor("exact", PEOPLE)).toEqual(person(ME));
    expect(selectionFor("pct", PEOPLE)).toEqual(person(ME));
    expect(selectionFor("adjust", PEOPLE)).toEqual(person(ME));
    expect(selectionFor("equal", PEOPLE)).toEqual(AMOUNT);
    expect(selectionFor("shares", PEOPLE)).toEqual(AMOUNT);
    expect(selectionFor("items", PEOPLE)).toEqual(AMOUNT);
  });

  it("is off on Itemized, and on a tick or stepper method types only the amount", () => {
    expect(keypadLive(chooseMethod(form(), "items"), AMOUNT)).toBe(false);
    expect(keypadLive(form({ method: "shares" }), person(ME))).toBe(false);
    expect(pressKey(form({ method: "shares" }), person(ME), "5")).toEqual(form({ method: "shares" }));
  });

  it("hears the hardware keyboard", () => {
    expect(["7", ".", ",", "Backspace", "Delete", "-", "+", "a", "Enter"].map(keyFromKeyboard)).toEqual(["7", ".", ".", "del", "del", "±", "±", null, null]);
  });
});

describe("the method strip", () => {
  it("six pills in order", () => {
    expect(METHODS).toEqual(["equal", "exact", "pct", "shares", "adjust", "items"]);
  });
  it("one pill per 112 px, a flick moves one, the ends hold", () => {
    expect(stripRelease(0, -120, 0)).toBe(1);
    expect(stripRelease(2, 230, 0)).toBe(0);
    expect(stripRelease(2, -30, -0.8)).toBe(3);
    expect(stripRelease(2, -10, -0.8)).toBe(2);
    expect(stripRelease(5, -400, 0)).toBe(5);
  });
  it("leaving Itemized keeps the items, and the bill total becomes the amount", () => {
    let f = chooseMethod(form(), "items");
    f = { ...f, items: [{ ...f.items[0]!, totalText: "1800", shares: { [ME]: { mode: "portion", value: 1000 } } }] };
    const back = chooseMethod(f, "equal");
    expect(back.method).toBe("equal");
    expect(back.amountText).toBe("1800");
    expect(back.items).toHaveLength(1);
  });
});

describe("the keypad sends what the old form sent", () => {
  // The old form's per-row inputs wrote these texts; the keypad writes the same.
  const cases: [string, ExpenseForm, ExpenseForm][] = [];
  const base = form({ amountText: "" });
  const typed = (method: ExpenseForm["method"], sel: (id: string) => Selected, values: Record<string, string>) => {
    let f = type(chooseMethod(base, method), AMOUNT, "2 4 0 0");
    for (const [id, keys] of Object.entries(values)) f = type(f, sel(id), keys);
    return f;
  };
  cases.push(["equal", toggleIn(type(base, AMOUNT, "2 4 0 0"), DEV), form({ equal: { [ME]: true, [ANU]: true, [DEV]: false, [MEERA]: true } })]);
  cases.push(["exact", typed("exact", person, { [ME]: "6 0 0", [ANU]: "6 0 0", [DEV]: "6 0 0", [MEERA]: "6 9 del 0 0 . 0 0 9" }), form({ method: "exact", exact: { [ME]: "600", [ANU]: "600", [DEV]: "600", [MEERA]: "600.00" } })]);
  cases.push(["pct", typed("pct", person, { [ME]: "4 0", [ANU]: "2 0", [DEV]: "2 0", [MEERA]: "2 0" }), form({ method: "pct", pct: { [ME]: "40", [ANU]: "20", [DEV]: "20", [MEERA]: "20" } })]);
  cases.push(["shares", stepShares(type(chooseMethod(base, "shares"), AMOUNT, "2 4 0 0"), ME, 1), form({ method: "shares", shares: { [ME]: 2, [ANU]: 1, [DEV]: 1, [MEERA]: 1 } })]);
  cases.push(["adjust", typed("adjust", person, { [DEV]: "2 0 0", [MEERA]: "± 1 0 0" }), form({ method: "adjust", adjust: { [ME]: "", [ANU]: "", [DEV]: "+200", [MEERA]: "-100" } })]);

  it.each(cases)("%s", (_m, viaKeypad, viaOldForm) => {
    const a = buildRequest(viaKeypad, "INR");
    const b = buildRequest(viaOldForm, "INR");
    expect(a.ok).toBe(true);
    expect(a).toEqual(b);
  });
});

describe("the Add screen", () => {
  const APP = `${process.cwd()}/../../apps/spliteco-web/src`;
  const sheet = readFileSync(`${APP}/components/add/add-sheet.tsx`, "utf8");
  it("opens no OS keyboard for the amount or a person's field", () => {
    // The amount and the fields are buttons; the only text inputs are the title.
    expect(sheet.match(/<input/g)?.length).toBe(1);
    expect(sheet).toContain('aria-label="What for?"');
  });
  it("drags down to close, and the strip swipes", () => {
    expect(sheet).toContain("useSheetDrag(onClose)");
    expect(sheet).toContain("listenForDrags(viewport");
  });
});
