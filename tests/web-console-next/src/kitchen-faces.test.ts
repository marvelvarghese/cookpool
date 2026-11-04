// Faces for people (Cookpool SM-7, design §2 "Faces everywhere", rule 4):
// the one row of faces Use, Dish and Bill pick people with — you first, a tap
// in or out — and the main button that says who it is for ("You + Anu ·
// ₹8.50 each"). The row is rendered with react-dom/server; the words, the
// order and the colours are the pure half (faces.ts).

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMinor } from "@saas/kitchen-engine/money";
import { FACE_COLORS, ME_FACE, eachText, faceColor, faceOrder, forWhom, toggleFace, whoLine } from "@web-console-next/components/kitchen/faces";
import { Face, FaceRow, MainButtonLabel } from "@web-console-next/components/kitchen/faces-ui";
import { expenseAddedText, expenseButton, initialExpenseForm, previewExpense } from "@web-console-next/components/kitchen/expense-form";
import { amountCost, shareBreakdown } from "@web-console-next/components/kitchen/item-use";
import { ANU, DEV, FLAT, KIRAN, ME, MEERA, NAMES, groupRef, makeItem } from "./kitchen-pantry-fixtures";

const VEENA = "usr_0000000000000000000000000000e3e3";
const ALL_NAMES = new Map<string, string>([...NAMES, [VEENA, "Veena"]]);
const GROUP = [MEERA, DEV, ME, VEENA, ANU];

/** The faces' buttons as rendered: [aria-label, aria-pressed], in order. */
function faces(html: string): [string, string][] {
  return [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*aria-label="([^"]*)"/g)].map((m) => [m[2]!, m[1]!]);
}

function row(props: Partial<React.ComponentProps<typeof FaceRow>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(FaceRow, {
      legend: "Who?",
      people: GROUP,
      chosen: new Set([ME]),
      onToggle: () => undefined,
      meId: ME,
      names: ALL_NAMES,
      ...props,
    }),
  );
}

describe("the row of faces", () => {
  it("puts you first, then everyone by name", () => {
    expect(faceOrder(GROUP, ME, ALL_NAMES)).toEqual([ME, ANU, DEV, MEERA, VEENA]);
    // Anu sees herself first; Rahul (no name on her device here) sorts as "Member · 00aa".
    expect(faceOrder(GROUP, ANU, ALL_NAMES)).toEqual([ANU, DEV, MEERA, ME, VEENA]);
    expect(faces(row()).map(([name]) => name)).toEqual(["You", "Anu", "Dev", "Meera", "Veena"]);
  });

  it("shows who is in, and a tap puts a person in or takes them out", () => {
    expect(faces(row({ chosen: new Set([ME, DEV]) }))).toEqual([
      ["You", "true"],
      ["Anu", "false"],
      ["Dev", "true"],
      ["Meera", "false"],
      ["Veena", "false"],
    ]);
    const start: ReadonlySet<string> = new Set([ME]);
    const withAnu = toggleFace(start, ANU);
    expect([...withAnu]).toEqual([ME, ANU]);
    expect([...toggleFace(withAnu, ME)]).toEqual([ANU]);
    expect([...toggleFace(toggleFace(start, ANU), ANU)]).toEqual([ME]);
    // Never changes what it was given.
    expect([...start]).toEqual([ME]);
  });

  it("keeps a big group to two rows until More, with anyone picked further down still shown", () => {
    const big = Array.from({ length: 14 }, (_, i) => `usr_${String(i).padStart(32, "0")}`);
    const html = row({ people: [ME, ...big], chosen: new Set([ME, big[13]!]), max: 10 });
    expect(faces(html)).toHaveLength(11);
    expect(faces(html)[10]).toEqual(["Member · 0013", "true"]);
    expect(html).toContain("+4");
    // While the group loads: placeholders, no faces.
    expect(faces(row({ people: null }))).toEqual([]);
  });

  it("gives each person the same colour everywhere, and you the app's green", () => {
    expect(faceColor(ME, ME)).toBe(ME_FACE);
    for (const id of [ANU, DEV, MEERA, KIRAN, VEENA]) {
      expect(FACE_COLORS).toContain(faceColor(id, ME));
      // Whoever looks (unless it is them): the same colour.
      expect(faceColor(id, ME)).toBe(faceColor(id, null));
    }
    expect(faceColor(ANU, ANU)).toBe(ME_FACE);
    expect(renderToStaticMarkup(React.createElement(Face, { subjectId: ANU, meId: ME, names: ALL_NAMES }))).toContain(">A<");
  });
});

describe("the main button says who it is for", () => {
  it("names one, two, three and many, you first", () => {
    expect(forWhom([ANU], ME, ALL_NAMES)).toBe("Anu");
    expect(forWhom([ME], ME, ALL_NAMES)).toBe("You");
    expect(forWhom([ME, ANU], ME, ALL_NAMES)).toBe("You + Anu");
    expect(forWhom([ME, ANU, DEV], ME, ALL_NAMES)).toBe("You + Anu + Dev");
    expect(forWhom([ME, ANU, DEV, MEERA, VEENA], ME, ALL_NAMES)).toBe("You + Anu + 3 more");
    expect(forWhom([], ME, ALL_NAMES)).toBe("");
  });

  it("adds what each pays, honestly when the paisa don't divide", () => {
    expect(eachText([850, 850], "INR")).toBe(`${formatMinor(850)} each`);
    expect(eachText([334, 333, 333], "INR")).toBe(`≈ ${formatMinor(333)} each`);
    expect(eachText([850], "INR")).toBeNull();
    expect(whoLine({ ids: [ME, ANU], meId: ME, names: ALL_NAMES, amounts: [850, 850], currency: "INR" })).toBe("You + Anu · ₹8.50 each");
    expect(whoLine({ ids: [ANU], meId: ME, names: ALL_NAMES, amounts: [1700], currency: "INR" })).toBe("Anu");
    expect(whoLine({ ids: [ME, ANU, DEV], meId: ME, names: ALL_NAMES })).toBe("You + Anu + Dev");
    expect(whoLine({ ids: [], meId: ME, names: ALL_NAMES, amounts: [], currency: "INR" })).toBeNull();
  });

  it("on Use: a glass of Meera's milk for you and Anu is ₹8.50 each", () => {
    const milk = makeItem({ name: "Milk", pantry: groupRef(FLAT), unit: "L", bought: "1", left: "1", priceMinor: 6800, paidBy: MEERA });
    const qtyMilli = 250_000;
    expect(amountCost(milk, qtyMilli)).toBe(1700);
    const lines = shareBreakdown({ item: milk, qtyMilli, consumers: [ME, ANU], meId: ME, names: ALL_NAMES }).lines;
    expect(whoLine({ ids: faceOrder([ANU, ME], ME, ALL_NAMES), meId: ME, names: ALL_NAMES, amounts: lines.map((l) => l.amountMinor), currency: "INR" })).toBe(
      "You + Anu · ₹8.50 each",
    );
  });

  it("on Bill: what it adds, and who it is for", () => {
    const people = faceOrder(GROUP, ME, ALL_NAMES);
    const start = initialExpenseForm(people, ME);
    // No amount yet: it says what it is; everyone is in.
    expect(expenseButton({ preview: previewExpense(start, people), mode: "equal", meId: ME, names: ALL_NAMES, currency: "INR" })).toEqual({
      title: "Add expense",
      who: "You + Anu + 3 more",
    });
    const two = { ...start, title: "Vegetables", amount: "17", included: Object.fromEntries(people.map((id) => [id, id === ME || id === ANU])) };
    expect(expenseButton({ preview: previewExpense(two, people), mode: "equal", meId: ME, names: ALL_NAMES, currency: "INR" })).toEqual({
      title: "Add · ₹17.00",
      who: "You + Anu · ₹8.50 each",
    });
    const justAnu = { ...two, included: Object.fromEntries(people.map((id) => [id, id === ANU])) };
    expect(expenseButton({ preview: previewExpense(justAnu, people), mode: "equal", meId: ME, names: ALL_NAMES, currency: "INR" }).who).toBe("Anu");
    // Shares: who is in, no "each".
    const shares = { ...two, mode: "shares" as const, shares: { [ME]: 2, [DEV]: 1 } };
    expect(expenseButton({ preview: previewExpense(shares, people), mode: "shares", meId: ME, names: ALL_NAMES, currency: "INR" }).who).toBe("You + Dev");
    // Nobody in: no second line.
    const nobody = { ...two, included: {} };
    expect(expenseButton({ preview: previewExpense(nobody, people), mode: "equal", meId: ME, names: ALL_NAMES, currency: "INR" }).who).toBeNull();
  });

  it("draws its two lines, the second only when there is someone", () => {
    expect(renderToStaticMarkup(React.createElement(MainButtonLabel, { title: "Add · ₹17.00", who: "You + Anu · ₹8.50 each" }))).toContain(
      "You + Anu · ₹8.50 each",
    );
    expect(renderToStaticMarkup(React.createElement(MainButtonLabel, { title: "Pick who had it", who: null }))).not.toContain("opacity-90");
  });

  it("says the expense once in its toast: 'split equally', not 'split split equally'", () => {
    expect(expenseAddedText({ totalMinor: 120000, mode: "equal" }, "INR")).toBe("₹1,200.00, split equally.");
    expect(expenseAddedText({ totalMinor: 120000, mode: "exact" }, "INR")).toBe("₹1,200.00, exact amounts.");
    expect(expenseAddedText({ totalMinor: 120000, mode: "percent" }, "INR")).toBe("₹1,200.00, by percentage.");
    expect(expenseAddedText({ totalMinor: 120000, mode: "shares" }, "INR")).toBe("₹1,200.00, by shares.");
  });
});
