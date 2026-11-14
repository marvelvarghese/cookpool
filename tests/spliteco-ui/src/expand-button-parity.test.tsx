/**
 * @jest-environment jsdom
 */
// money-native MY-19: the expanding button and its boxes equal the ExpandButton, Settle_Custom and
// Person_Dev boards, number for number (390x844). Every figure below is read from a board's markup.

import { jest } from "@jest/globals";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { BOX_HEIGHTS, DIM, ExpandButton, type ExpandButtonKind } from "@saas/spliteco-ui/expand-button";
import { SettleContent, SettleUpContent } from "@saas/spliteco-ui/settle-box-ui";
import { ExpenseBox } from "@saas/spliteco-ui/expense-ui";
import type { ExpenseGroup } from "@saas/spliteco-ui/expense";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const W = 390;
const H = 844;
let host: HTMLDivElement;
let root: Root;
const show = (node: React.ReactNode) => act(() => { root.render(node); });
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
/** A length in px: `var(--x, 96px)` takes its fallback (no stylesheet here), `calc(a + b)` sums. */
const px = (v: string): number => {
  const flat = v.replace(/var\([^,)]+,\s*([^)]+)\)/g, "$1");
  const sum = flat.match(/^calc\((.+)\)$/);
  return sum ? sum[1]!.split("+").reduce((t, n) => t + parseFloat(n), 0) : parseFloat(flat);
};
const box = () => host.querySelector<HTMLElement>("[data-expand-box]")!;
/** left/top/width/height of the box as the board states them, from the left/right/bottom/height the button sets. */
const rect = (el: HTMLElement) => {
  const left = px(el.style.left), right = px(el.style.right), bottom = px(el.style.bottom), height = px(el.style.height);
  return { left, top: H - bottom - height, width: W - left - right, height };
};

beforeEach(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); jest.useRealTimers(); });

const KINDS: Array<[ExpandButtonKind, number, number]> = [["settle", 170, 560], ["expense", 120, 610], ["people", 300, 430]];

describe("the button, closed and open (ExpandButton board)", () => {
  it.each(KINDS)("%s: closed 20/696 350x52 radius 12; open 12/%i 366x%i radius 20", (kind, top, height) => {
    show(<ExpandButton kind={kind} label="x" theme="cookpool" reduceMotion={false} bottomOffset={96}>y</ExpandButton>);
    expect(rect(box())).toEqual({ left: 20, top: 696, width: 350, height: 52 });
    expect(box().style.borderRadius).toBe("12px");
    click(host.querySelector("button[aria-haspopup]")!);
    expect(rect(box())).toEqual({ left: 12, top, width: 366, height });
    expect(box().style.borderRadius).toBe("20px");
    expect(BOX_HEIGHTS[kind]).toBe(height);
  });

  it("dims with rgba(27,36,32,.42) in both themes, over .3s", () => {
    for (const theme of ["cookpool", "spliteco"] as const) {
      show(<ExpandButton kind="settle" label="x" theme={theme} defaultOpen>y</ExpandButton>);
      const dim = host.querySelector<HTMLElement>("[data-expand-dim]")!;
      expect(DIM).toBe("rgba(27,36,32,.42)");
      expect(dim.style.background).toBe("rgba(27, 36, 32, 0.42)");
      expect(dim.style.transition).toBe("opacity 300ms ease");
    }
  });

  it("moves left, right, bottom and height in .45s cubic-bezier(.2,.8,.2,1); radius and background in .45s ease; content in .25s after .3s", () => {
    show(<ExpandButton kind="settle" label="x" theme="cookpool" reduceMotion={false} defaultOpen>y</ExpandButton>);
    const t = box().style.transition;
    for (const p of ["left", "right", "bottom", "height"]) expect(t).toContain(`${p} 450ms cubic-bezier(.2,.8,.2,1)`);
    expect(t).toContain("border-radius 450ms ease");
    expect(t).toContain("background-color 450ms ease");
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.style.transition).toBe("opacity 250ms ease 300ms");
    expect(host.querySelector<HTMLElement>("button[aria-haspopup]")!.style.transition).toBe("opacity 120ms ease");
  });

  it("sets the board's face: Plus Jakarta Sans, tabular numbers, a 36px title row of 18/500 and a 44px close", () => {
    show(<ExpandButton kind="settle" label="x" theme="cookpool" defaultOpen>y</ExpandButton>);
    const root_ = host.querySelector<HTMLElement>("[data-expand-button]")!;
    expect(root_.style.fontFamily).toContain("Plus Jakarta Sans");
    expect(root_.style.fontVariantNumeric).toBe("tabular-nums");
    const h2 = host.querySelector<HTMLElement>("h2")!;
    expect(h2.parentElement!.style.height).toBe("36px");
    expect([h2.style.fontSize, h2.style.fontWeight]).toEqual(["18px", "500"]);
    const close = host.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    expect([close.style.width, close.style.height, close.style.marginRight]).toEqual(["44px", "44px", "-12px"]);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.padding).toBe("16px 20px 20px");
  });
});

const dev: SplitecoPersonBalance = {
  subjectId: "usr_dev", name: "Dev", balances: [{ currency: "INR", amountMinor: -150000 }], settled: false, upiVpa: "dev@upi", lastRemindedAt: null,
  groups: [
    { groupId: "org_goa", groupName: "Goa trip", kind: "trip", madeIn: "spliteco", currency: "INR", amountMinor: -120000, buckets: null },
    { groupId: "org_k", groupName: "Flat 4B", kind: "kitchen", madeIn: "cookpool", currency: "INR", amountMinor: -30000, buckets: { kitchen: -30000, other: 0 } },
  ],
  plans: [{ groupId: "org_k", groupName: "Flat 4B", currency: "INR", fromSubjectId: "usr_me", toSubjectId: "usr_dev", amountMinor: 30000 }],
};
const api = { recordPayment: async () => undefined, paymentReceived: async () => undefined };
const styleOf = (sel: string, from: ParentNode = host) => from.querySelector<HTMLElement>(sel)!.style;
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === text)!;

describe("the settle box (ExpandButton and Settle_Custom boards)", () => {
  const mountSettle = () => show(
    <ExpandButton kind="settle" label="Settle ₹1,500" theme="cookpool" defaultOpen>
      {({ close }) => <SettleContent theme="cookpool" person={dev} meId="usr_me" api={api} onDone={close} />}
    </ExpandButton>,
  );

  it("has a 40/500 amount, 44px chips with 10px radius, a 14px card, 44px rows with a rule above every row, 52px/12px Paid", () => {
    mountSettle();
    const amount = styleOf("[data-amount]");
    expect([amount.fontSize, amount.fontWeight, amount.letterSpacing]).toEqual(["40px", "500", "-0.02em"]);
    const chip = host.querySelector<HTMLElement>('[aria-label="Amount"] button')!.style;
    expect([chip.height, chip.borderRadius, chip.padding, chip.fontSize]).toEqual(["44px", "10px", "0px 16px", "14px"]);
    expect(styleOf("[data-lines]").borderRadius).toBe("14px");
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-line]"));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect([r.style.height, r.style.padding]).toEqual(["44px", "0px 14px"]);
    }
    const paid = styleOf('[data-action="paid"]');
    expect([paid.height, paid.borderRadius, paid.fontSize, paid.fontWeight]).toEqual(["52px", "12px", "15px", "500"]);
    expect(host.querySelector("[data-amount] > span")).toBeNull(); // no custom cursor yet
  });

  it("has no height-padding under the amount when there is no note (the board's empty note has no height)", () => {
    mountSettle();
    const note = host.querySelector("[data-amount]")!.parentElement!.lastElementChild as HTMLElement;
    expect(note.textContent).toBe("");
    expect(note.style.minHeight).toBe("");
  });

  it("Custom: a 44px amount with a 2x40 cursor, a 3-column keypad of 52px keys with 16px radius and 8px gaps, and a taller box", () => {
    mountSettle();
    expect(rect(box()).height).toBe(560);
    click(button("Custom"));
    const amount = styleOf("[data-amount]");
    expect(amount.fontSize).toBe("44px");
    const cursor = host.querySelector<HTMLElement>("[data-amount] > span")!.style;
    expect([cursor.width, cursor.height]).toEqual(["2px", "40px"]);
    const pad = styleOf("[data-keypad]");
    expect([pad.gridTemplateColumns, pad.gap]).toEqual(["repeat(3, minmax(0, 1fr))", "8px"]);
    const keys = Array.from(host.querySelectorAll<HTMLElement>("[data-keypad] button"));
    expect(keys.map((k) => k.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]);
    for (const k of keys) expect([k.style.height, k.style.borderRadius, k.style.fontSize, k.style.fontWeight]).toEqual(["52px", "16px", "22px", "500"]);
    expect(rect(box()).height).toBe(700);
  });

  it("the Done screen has no title row (the board's has none) yet the dialog keeps its name", async () => {
    mountSettle();
    expect(host.querySelector<HTMLElement>("h2")!.parentElement!.style.height).toBe("36px");
    click(button("Cash"));
    await act(async () => { host.querySelector<HTMLElement>('[data-action="paid"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[data-step="done"]')).not.toBeNull();
    expect(host.querySelector<HTMLElement>("h2")!.parentElement!.style.height).toBe("1px"); // clipped away, still in the reading order
    expect(host.querySelector<HTMLElement>('button[aria-label="Close"]')!.tabIndex).toBe(-1);
    expect(host.querySelector('[role="dialog"]')!.getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
    const doneBtn = button("Done");
    expect([doneBtn.style.height, doneBtn.style.borderRadius]).toEqual(["52px", "12px"]);
  });
});

describe("Settle up (ExpandButton board)", () => {
  it("has 60px rows with 34px avatars, 44px soft buttons with 10px radius, and a 52px Settle all", () => {
    show(
      <ExpandButton kind="people" label="Settle up" theme="cookpool" defaultOpen>
        {({ close }) => <SettleUpContent theme="cookpool" people={[dev]} meId="usr_me" api={api} onDone={close} />}
      </ExpandButton>,
    );
    const row = styleOf("[data-row]");
    expect([row.height, row.padding, row.gap]).toEqual(["60px", "0px 10px 0px 14px", "12px"]);
    const avatar = host.querySelector<HTMLElement>("[data-row] > span")!.style;
    expect([avatar.width, avatar.height, avatar.fontSize]).toEqual(["34px", "34px", "12px"]);
    const got = styleOf('[data-action="paid"]');
    expect([got.height, got.borderRadius]).toEqual(["44px", "10px"]);
    const all = styleOf('[data-action="settle-all"]');
    expect([all.height, all.borderRadius]).toEqual(["52px", "12px"]);
    expect(host.querySelector('[data-action="settle-all"]')!.textContent).toBe("Settle all 1");
  });
});

describe("the expense box (ExpandButton board)", () => {
  const flat: ExpenseGroup = { id: "org_flat", name: "Flat 4B", currency: "INR", members: [{ subjectId: "usr_me", name: "Me" }, { subjectId: "usr_a", name: "Asha" }, { subjectId: "usr_k", name: "Kiran" }] };
  it("has a 40/500 amount, 52px Group and Paid by tiles, a 40px Equal|Exact switch, 44px share rows with 28px avatars, a 52px Save", () => {
    show(<ExpenseBox theme="cookpool" groups={[flat]} me="usr_me" createExpense={async () => undefined} />);
    const amount = styleOf('input[name="amount"]');
    expect([amount.fontSize, amount.fontWeight]).toEqual(["40px", "500"]);
    const tiles = Array.from(host.querySelectorAll<HTMLElement>("label")).slice(0, 2);
    expect(tiles.map((t) => t.querySelector("span[aria-hidden]")!.textContent)).toEqual(["Flat 4B ▾", "You ▾"]);
    for (const t of tiles) expect([t.style.height, t.style.borderRadius, t.style.padding]).toEqual(["52px", "12px", "0px 12px"]);
    const sw = styleOf("[data-switch]");
    expect([sw.padding, sw.gap, sw.borderRadius]).toEqual(["4px", "4px", "12px"]);
    const eq = styleOf('[data-method="equal"]');
    expect([eq.height, eq.borderRadius]).toEqual(["40px", "9px"]);
    expect(styleOf("[data-shares]").borderRadius).toBe("14px");
    const row = host.querySelector<HTMLElement>("[data-person] label")!.style;
    expect([row.height, row.padding, row.gap]).toEqual(["44px", "0px 14px", "10px"]);
    const av = host.querySelector<HTMLElement>("[data-person] label > span")!.style;
    expect([av.width, av.height, av.borderRadius, av.fontSize]).toEqual(["28px", "28px", "50%", "11px"]);
    const save = styleOf('[data-action="save"]');
    expect([save.height, save.borderRadius]).toEqual(["52px", "12px"]);
  });
});
