// money-native MY-20: the Money sheets and the Manage page hold the boards'
// measurements (Money_AddGroup, Money_AddGroupFrom, Money_PickSpliteco,
// Group_Manage, Group_Waste), pinned here so they cannot drift.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoGroupResponse, SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { LookScope } from "@saas/spliteco-ui/look";
import { Sheet } from "@web-console-next/components/ui/sheet";
import { PrimaryAction, RadioRow, SHEET, SheetTitleRow, fieldStyle, smallButtonStyle } from "@web-console-next/components/kitchen/money-sheet-kit";
import { pickerSubtitle } from "@web-console-next/components/kitchen/money-start-from-spliteco";
import { SplitecoGroupPicker, StartFromSplitecoRow } from "@web-console-next/components/kitchen/money-start-from-spliteco-ui";
import { ManageGroupView } from "@web-console-next/components/kitchen/money-manage-view";
import { WASTE_RULES } from "@web-console-next/components/kitchen/groups";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (p: string) => readFileSync(`${root}/${p}`, "utf8");
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const g = (id: string, name: string, over: Partial<SplitecoGroupSummary> = {}): SplitecoGroupSummary => ({
  id, name, kind: "trip", madeIn: "spliteco", role: "owner", currency: "INR", memberCount: 4, myBalanceMinor: 0, myPlan: [], myBuckets: null, ...over,
});

describe("the sheet's numbers are the boards'", () => {
  it("sheet, handle, title, fields, rows and buttons", () => {
    expect(SHEET).toMatchObject({
      radius: 28, padding: "10px 20px", paddingBottom: 32, gap: 16,
      handle: { width: 40, height: 4 }, titleRow: 36, title: 22, hit: 44,
      scrim: "rgba(27,36,32,.42)", field: 52, fieldRadius: 16, search: 48, cardRadius: 20,
      radioRow: 64, radioDot: 22, startRow: 56, groupRow: 64, avatar: 36, actionRow: 52,
      button: 52, buttonRadius: 12, smallButton: 36, smallButtonRadius: 10,
    });
  });

  it("the sheet is 28px at the top, bottom-anchored, on the board's scrim, with its own 44px Close", () => {
    const kit = read("components/kitchen/money-sheet-kit.tsx");
    expect(kit).toContain("rounded-t-[28px]");
    expect(kit).toContain('side="bottom"');
    expect(kit).toContain("bg-[rgba(27,36,32,.42)]");
    expect(kit).toContain("bareClose");
    expect(kit).toContain("SHEET.paddingBottom");
    expect(kit).toContain('lineHeight: "normal"');
    expect(kit).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it("title row: 22px/500 title, a 44px Close at the right, or a 44px Back at the left", () => {
    const close = render(createElement(Sheet, {}, createElement(SheetTitleRow, { title: "Add group" })));
    expect(close).toContain("height:36px");
    expect(close).toContain("font-size:22px;font-weight:500");
    expect(close).toContain('aria-label="Close"');
    expect(close).toContain("width:44px;height:44px");
    const back = render(createElement(Sheet, {}, createElement(SheetTitleRow, { title: "Spliteco groups", onBack: () => {} })));
    expect(back).toContain('aria-label="Back"');
    expect(back).not.toContain('aria-label="Close"');
  });

  it("a field is 52px, radius 16, 16px text, on the surface", () => {
    expect(fieldStyle).toMatchObject({ height: 52, borderRadius: 16, fontSize: 16, background: "var(--look-surface)" });
  });

  it("a radio row is 64px with a 22px dot: a 6px green ring when chosen, tinted; a 2px grab ring when not", () => {
    const on = render(createElement(RadioRow, { checked: true, first: true, name: "w", value: "a", label: "Split equally", hint: "Shared.", onSelect: () => {} }));
    expect(on).toContain("min-height:64px");
    expect(on).toContain("width:22px;height:22px");
    expect(on).toContain("border:6px solid var(--look-primary)");
    expect(on).toContain("background:var(--look-soft)");
    const off = render(createElement(RadioRow, { checked: false, first: false, name: "w", value: "b", label: "Buyer", onSelect: () => {} }));
    expect(off).toContain("border:2px solid var(--look-grab)");
    expect(off).toContain("border-top:1px solid var(--look-line)");
    expect(off).toContain('type="radio"');
  });

  it("the primary action is 52px, radius 12, label left, chevron right", () => {
    const html = render(createElement(PrimaryAction, { type: "submit" }, "Create group"));
    expect(html).toContain("height:52px");
    expect(html).toContain("border-radius:12px");
    expect(html).toContain("background:var(--look-primary)");
    expect(html).toContain("Create group");
    expect(html).toContain("<svg");
  });

  it("the small button (Copy) is 36px, radius 10, soft", () => {
    expect(smallButtonStyle).toMatchObject({ height: 36, borderRadius: 10, background: "var(--look-soft)", color: "var(--look-softInk)", fontSize: 14, fontWeight: 500 });
  });
});

describe("Start from Spliteco and its picker", () => {
  it("the row is 56px, radius 16, on the surface: a 12px muted label over the 15/500 value", () => {
    const html = render(createElement(StartFromSplitecoRow, { picked: null, onOpen: () => {} }));
    expect(html).toContain("height:56px");
    expect(html).toContain("border-radius:16px");
    expect(html).toContain("background:var(--look-surface)");
    expect(html).toMatch(/font-size:12px[^>]*>Start from Spliteco/);
    expect(html).toContain("Pick a group");
    const picked = render(createElement(StartFromSplitecoRow, { picked: { name: "Weekend crew", people: 4 }, onOpen: () => {} }));
    expect(picked).toContain("Weekend crew");
    expect(picked).toMatch(/color:var\(--look-primary\)[^>]*>Change/);
  });

  it("the picker: Back and title, a 48px search, Recent, 64px rows with 36px avatars, Added muted", () => {
    const html = render(
      createElement(Sheet, {}, createElement(LookScope, { theme: "cookpool" }, createElement(SplitecoGroupPicker, {
        groups: [g("org_a", "Weekend crew", { myBalanceMinor: 26000 }), g("org_b", "Book club", { memberCount: 3, madeIn: "cookpool" })],
        recent: ["org_a", "org_b"], addedIds: [], onPick: () => {}, onClose: () => {},
      }))),
    );
    expect(html).toContain("Spliteco groups");
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain("height:48px");
    expect(html).toContain('placeholder="Search 2 groups"');
    expect(html).toContain(">Recent<");
    expect(html).toContain("height:64px");
    expect(html).toContain("width:36px;height:36px");
    expect(html).toContain("4 people · you get ₹260");
    const added = html.match(/<button[^>]*data-group="org_b"[^>]*>/)?.[0] ?? "";
    expect(added).toContain("opacity:0.6");
    expect(added).toContain("disabled");
    expect(html).toContain(">Added<");
  });

  it("each row's second line reads people, then what you get or owe, or settled", () => {
    expect(pickerSubtitle(g("x", "X", { myBalanceMinor: 26000 }))).toBe("4 people · you get ₹260");
    expect(pickerSubtitle(g("x", "X", { memberCount: 8, myBalanceMinor: -14000 }))).toBe("8 people · you owe ₹140");
    expect(pickerSubtitle(g("x", "X", { memberCount: 6 }))).toBe("6 people · settled");
  });
});

describe("Add group", () => {
  const src = read("components/kitchen/money-add-group-ui.tsx");

  it("is the shared board sheet: no caption beyond the board, no old rounded-[22px] sheet or 10px field", () => {
    expect(src).toContain("<BoardSheet");
    expect(src).toContain("<SheetTitleRow");
    expect(src).not.toContain("rounded-[22px]");
    expect(src).not.toContain("K_INPUT");
    expect(src).not.toContain("lucide-react");
  });

  it("has Name, Currency, When food goes to waste and People in the board's order, then the action", () => {
    const order = ['label="Name"', 'label="Currency"', 'label="When food goes to waste"', 'label="People"', "<PrimaryAction"].map((t) => src.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a picked group changes the action to Add to Cookpool and the People card to who comes along", () => {
    expect(src).toContain('"Add to Cookpool"');
    expect(src).toContain("come along");
  });

  it("uses the radio row and offers the two food rules", () => {
    expect(src).toContain("<RadioRow");
    expect(WASTE_RULES.map((r) => r.hint)).toEqual(["Food that goes off is shared by everyone.", "Whoever added it pays for what goes to waste."]);
  });
});

describe("Manage group", () => {
  const detail = {
    group: { ...g("org_f", "Flat 4B", { kind: "kitchen", madeIn: "cookpool", memberCount: 3 }) },
    members: [{ subjectId: "usr_me", name: "Rahul", role: "owner" }, { subjectId: "u2", name: "Asha", role: "builder" }],
    balances: [{ subjectId: "u2", balanceMinor: 32000 }],
    plan: [], buckets: null, totalSpentMinor: 0, expenses: [], people: [], canWrite: true, settings: { simplifyDebts: true }, upi: [], reminded: [],
  } as unknown as SplitecoGroupResponse;
  const noop = () => undefined;
  const html = render(createElement(ManageGroupView, { detail, meId: "usr_me", settings: { currency: "INR", wastePolicy: "split_equally", updatedAt: null }, joinLink: "https://x/j/ABCD", onBack: noop, onSimplify: noop, onCurrency: noop, onWaste: noop, onCopyLink: noop, onLeave: noop }));

  it("cards are 20px; person rows 56 (57 under a divider), settings rows 50, Add person 52, Leave 52", () => {
    expect(html).toContain("border-radius:20px");
    expect(html).not.toContain("border-radius:12px;overflow:hidden");
    expect(html).toContain("min-height:56px");
    expect(html).toContain("min-height:57px");
    expect(html).toContain("min-height:50px");
    expect(html).toContain("min-height:51px");
    expect(html).toMatch(/data-action="add-person"[^>]*min-height:53px/);
    expect(html).toMatch(/data-action="leave"[^>]*min-height:52px/);
  });

  it("the switch is 46x28 with a 22px knob, and its tap area reaches 44px", () => {
    expect(html).toMatch(/role="switch"[^>]*width:46px;height:28px;border-radius:14px/);
    expect(html).toContain("width:22px;height:22px");
    expect(html).toContain("after:-inset-y-2");
  });

  it("Add person is the primary colour with a plus; Copy is the 36px tinted button with a 44px tap area", () => {
    expect(html).toMatch(/data-action="add-person"[^>]*color:var\(--look-primary\)/);
    expect(html).toMatch(/<button[^>]*after:-inset-y-1[^>]*height:36px[^>]*>Copy/);
  });

  it("controls carry the console's focus ring", () => {
    expect(read("components/kitchen/money-manage-view.tsx")).toContain("FOCUS");
    expect(read("components/kitchen/money-sheet-kit.tsx")).toContain("focus-visible:ring-2 focus-visible:ring-ring");
  });
});

describe("the console's own sheet", () => {
  it("can drop its built-in close and swap its scrim, so the board sheet is the shared one", () => {
    const sheet = read("components/ui/sheet.tsx");
    expect(sheet).toContain("scrimClassName");
    expect(sheet).toContain("bareClose");
  });
});
