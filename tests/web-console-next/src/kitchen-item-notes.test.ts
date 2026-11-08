// Item notes in the app (Cookpool RC-3, cookpool-recipes design §1.5): an
// optional Note on Bought (at most 80 characters, "For Sunday's curry", and
// who sees it), the item page's Note with its Undo, and the pantry row's
// third line — a pencil and the note, one line. All of it in the new frame
// only (`newFrame()`, true wherever the host is not prod): in prod nothing in
// the console changes. The views are rendered with react-dom/server; the
// words, the requests and the cache patches are the pure half (item-note.ts).

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KitchenItem, ReachableItem } from "@saas/contracts/kitchen";
import { resetAppConfigForTests } from "@web-console-next/lib/app-config";
import { newFrame } from "@web-console-next/lib/features";
import { applyPatches, type CacheKey, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import {
  ITEM_FIELDS,
  boughtSections,
  firstItemError,
  initialItemForm,
  previewItemForm,
  type ItemForm,
} from "@web-console-next/components/kitchen/item-form";
import {
  ITEM_NOTE_MAX,
  NOTE_PLACEHOLDER,
  canEditNote,
  noteChange,
  noteCount,
  noteHint,
  noteOf,
  notePatches,
  noteRefusal,
  noteSavedText,
  noteTooLong,
} from "@web-console-next/components/kitchen/item-note";
import { ItemNoteCard, NoteField, NoteLine } from "@web-console-next/components/kitchen/item-note-ui";
import { itemRowView, pantryListRow } from "@web-console-next/components/kitchen/pantry";
import { ItemTable, PantryListRowView } from "@web-console-next/components/kitchen/pantry-ui";
import { pendingItem } from "@web-console-next/components/kitchen/cache-patches";
import { ANU, DEV, FLAT, ME, PERSONAL_REF, groupRef, makeItem } from "./kitchen-pantry-fixtures";

const TODAY = "2026-11-08";
const CURRY = "For Sunday's curry";

// ── The frame ─────────────────────────────────────────────────────

const g = globalThis as unknown as { window?: { location: { host: string } } };

/** Serve the page on `host` (null: no window, as on the server), for `run`. */
function onHost<T>(host: string | null, run: () => T): T {
  const had = g.window;
  if (host === null) delete g.window;
  else g.window = { location: { host } };
  resetAppConfigForTests();
  try {
    return run();
  } finally {
    if (had === undefined) delete g.window;
    else g.window = had;
    resetAppConfigForTests();
  }
}

const PROD = "cookpool.store";
const STAGE = "stage.cookpool.store";

describe("the new frame (newFrame)", () => {
  it("is on everywhere but prod: stage, a stage or dev workers.dev host, local", () => {
    expect(onHost(PROD, newFrame)).toBe(false);
    expect(onHost("cookpool-web-console-next-prod.cookpool.workers.dev", newFrame)).toBe(false);
    expect(onHost(STAGE, newFrame)).toBe(true);
    expect(onHost("cookpool-web-console-next-stage.cookpool.workers.dev", newFrame)).toBe(true);
    expect(onHost("localhost:3000", newFrame)).toBe(true);
    expect(onHost("cookpool-web-console-next.cookpool.workers.dev", newFrame)).toBe(true);
  });
});

// ── Bought: the Note field ────────────────────────────────────────

function form(patch: Partial<ItemForm> = {}): ItemForm {
  return {
    ...initialItemForm({ today: TODAY, meId: ME }),
    name: "Paneer",
    category: "dairy",
    quantity: "200",
    unit: "g",
    price: "90",
    ...patch,
  };
}

const field = (props: Partial<React.ComponentProps<typeof NoteField>> = {}) =>
  renderToStaticMarkup(
    React.createElement(NoteField, { id: "item-note", value: "", onChange: () => undefined, pantry: { kind: "personal" }, ...props }),
  );

describe("Bought's Note, in both frames", () => {
  it("is under the details in the new frame, and not there at all in prod", () => {
    expect(boughtSections(false, true)).toEqual(["pantry", "name", "amount", "category", "useBy", "note"]);
    expect(boughtSections(true, true)).toEqual(["pantry", "name", "amount", "category", "paidBy", "waste", "useBy", "note"]);
    // Prod: today's form, section for section.
    expect(boughtSections(false)).toEqual(["pantry", "name", "amount", "category", "useBy"]);
    expect(boughtSections(true, false)).toEqual(["pantry", "name", "amount", "category", "paidBy", "waste", "useBy"]);
    // The page asks the host.
    expect(onHost(PROD, () => boughtSections(true, newFrame()))).not.toContain("note");
    expect(onHost(STAGE, () => boughtSections(true, newFrame())).at(-1)).toBe("note");
  });

  it("starts empty and sends nothing then — the request is today's, key for key", () => {
    expect(initialItemForm({ today: TODAY, meId: ME }).note).toBe("");
    const personal = previewItemForm(form(), { today: TODAY, currency: "INR", meId: ME });
    expect(personal.request).toEqual({
      kind: "personal",
      body: { name: "Paneer", category: "dairy", quantity: "200", unit: "g", priceMinor: 9000, boughtOn: TODAY, currency: "INR" },
    });
    const spaces = previewItemForm(form({ note: "   " }), { today: TODAY, currency: "INR", meId: ME });
    expect(spaces.request?.body).not.toHaveProperty("note");
    expect(spaces.errors).toEqual({});
  });

  it("sends a note trimmed, to your own pantry or a group's", () => {
    const mine = previewItemForm(form({ note: `  ${CURRY} ` }), { today: TODAY, currency: "INR", meId: ME });
    expect(mine.request).toMatchObject({ kind: "personal", body: { name: "Paneer", note: CURRY } });
    const shared = previewItemForm(form({ note: CURRY, pantry: FLAT.orgId, paidBy: ANU }), { today: TODAY, currency: "INR", meId: ME });
    expect(shared.request).toMatchObject({ kind: "group", orgId: FLAT.orgId, body: { note: CURRY, paidBy: ANU } });
  });

  it("holds 80 characters, as the server counts them; more is the note's error, focused last", () => {
    expect(ITEM_NOTE_MAX).toBe(80);
    expect(previewItemForm(form({ note: "x".repeat(80) }), { today: TODAY, meId: ME }).request?.body).toMatchObject({ note: "x".repeat(80) });
    // 80 emoji are 160 UTF-16 units but 80 characters: they fit.
    expect(previewItemForm(form({ note: "🍛".repeat(80) }), { today: TODAY, meId: ME }).errors).toEqual({});
    const long = previewItemForm(form({ note: "🍛".repeat(81) }), { today: TODAY, meId: ME });
    expect(long.errors).toEqual({ note: "Keep it to 80 characters" });
    expect(long.request).toBeNull();
    expect(firstItemError(long.errors)).toBe("note");
    expect(ITEM_FIELDS.at(-1)).toBe("note");
    expect(noteTooLong("🍛".repeat(81))).toBe(true);
    expect(noteTooLong(` ${"x".repeat(80)} `)).toBe(false);
  });

  it("says who will see it: you alone, or everyone in the group", () => {
    expect(noteHint({ kind: "personal" })).toBe("Only you see it");
    expect(noteHint(PERSONAL_REF)).toBe("Only you see it");
    expect(noteHint({ kind: "group", name: "Flat 4B" })).toBe("Everyone in Flat 4B sees it");
    expect(noteHint(groupRef(FLAT))).toBe("Everyone in Flat 4B sees it");
  });

  it("is one textarea of at most 80 characters, 'For Sunday's curry' until typed in, with the hint and a count", () => {
    const html = field();
    expect(html).toContain('<label for="item-note"');
    expect(html).toMatch(/<textarea[^>]*id="item-note"/);
    expect(html).toMatch(/<textarea[^>]*maxLength="80"/);
    expect(html).toContain(`placeholder="For Sunday&#x27;s curry"`);
    expect(NOTE_PLACEHOLDER).toBe(CURRY);
    expect(html).toContain("Only you see it");
    expect(html).toContain(">0/80<");
    expect(html).toMatch(/<textarea[^>]*aria-describedby="item-note-hint"/);

    const group = field({ value: CURRY, pantry: { kind: "group", name: "Flat 4B" } });
    expect(group).toContain("Everyone in Flat 4B sees it");
    expect(group).toContain(">18/80<");
    expect(group).toContain(`>${CURRY.replace("'", "&#x27;")}</textarea>`);
    expect(noteCount(`  ${CURRY}  `)).toBe("18/80");

    const wrong = field({ value: "🍛".repeat(81), error: "Keep it to 80 characters" });
    expect(wrong).toContain('aria-invalid="true"');
    expect(wrong).toContain("Keep it to 80 characters");
  });
});

// ── The pantry row's third line ───────────────────────────────────

const paneer = (patch: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ id: "itm_paneer", name: "Paneer", unit: "g", bought: "200", priceMinor: 9000, daysToUseBy: 1, note: CURRY, ...patch });

/** The item as read before RC-3: no note field at all. */
function withoutNote<T extends { note?: unknown }>(item: T): T {
  const copy = { ...item };
  delete copy.note;
  return copy;
}

function phoneRow(item: ReachableItem, notes?: boolean): string {
  const row = pantryListRow(item, { showPantry: true, ...(notes === undefined ? {} : { notes }) });
  return renderToStaticMarkup(React.createElement(PantryListRowView, { row, onLog: null }));
}

describe("the pantry row's note, in both frames", () => {
  it("is the row's third line in the new frame: a pencil, the note, one line ellipsized", () => {
    const row = pantryListRow(paneer(), { showPantry: true, notes: true });
    expect(row).toMatchObject({ name: "Paneer", chip: { tone: "soon" }, pantry: "Flat 4B", note: CURRY });
    const html = phoneRow(paneer(), true);
    // Name, then the chip and pantry, then the note.
    const name = html.indexOf(">Paneer<");
    const chip = html.indexOf("Flat 4B");
    const note = html.indexOf(CURRY.replace("'", "&#x27;"));
    expect(name).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(name);
    expect(note).toBeGreaterThan(chip);
    expect(html).toContain("lucide-pencil");
    expect(html).toMatch(/class="min-w-0 truncate">For Sunday&#x27;s curry</);
    expect(html).toContain('<span class="sr-only">Note: </span>');
  });

  it("is not there in prod: the row renders exactly what it rendered before", () => {
    const item = paneer();
    const before = withoutNote(item);
    // In prod the page passes notes: false — the row is today's row, byte for byte.
    expect(phoneRow(item, false)).toBe(phoneRow(before));
    expect(phoneRow(item)).toBe(phoneRow(before));
    expect(phoneRow(item, false)).not.toContain("lucide-pencil");
    expect(pantryListRow(item, { showPantry: true }).note).toBeNull();
    // The page asks the host.
    expect(onHost(PROD, () => pantryListRow(item, { showPantry: true, notes: newFrame() }).note)).toBeNull();
    expect(onHost(STAGE, () => pantryListRow(item, { showPantry: true, notes: newFrame() }).note)).toBe(CURRY);
  });

  it("shows nothing for an item without a note, or one read before notes", () => {
    expect(pantryListRow(paneer({ note: null }), { showPantry: false, notes: true }).note).toBeNull();
    expect(pantryListRow(makeItem({}), { showPantry: false, notes: true }).note).toBeNull();
    expect(phoneRow(paneer({ note: null }), true)).not.toContain("lucide-pencil");
  });

  it("sits under the name in the desktop table too, in the new frame only", () => {
    const item = paneer();
    const on = itemRowView(item, { meId: ME, notes: true });
    expect(on.note).toBe(CURRY);
    expect(itemRowView(item, { meId: ME }).note).toBeNull();
    const table = (rows: ReturnType<typeof itemRowView>[]) => renderToStaticMarkup(React.createElement(ItemTable, { rows, showPantry: false }));
    expect(table([on])).toContain("For Sunday&#x27;s curry");
    expect(table([itemRowView(item, { meId: ME, notes: false })])).toBe(table([itemRowView(withoutNote(item), { meId: ME })]));
    expect(table([itemRowView(item, { meId: ME })])).not.toContain("lucide-pencil");
  });

  it("is listed at once when Bought sends one (SM-5)", () => {
    const body = { name: "Paneer", category: "dairy", quantity: "200", unit: "g", priceMinor: 9000, note: CURRY };
    const shown = pendingItem({ body, pantry: groupRef(FLAT), currency: "INR", meId: ME, today: TODAY, at: "2026-11-08T08:00:00.000Z" })!;
    expect(shown.note).toBe(CURRY);
    expect(pantryListRow(shown, { showPantry: false, notes: true })).toMatchObject({ note: CURRY, pending: true });
    expect(pendingItem({ body: withoutNote(body), pantry: PERSONAL_REF, currency: "INR", meId: ME, today: TODAY, at: "2026-11-08T08:00:00.000Z" })!.note).toBeNull();
  });

  it("is a small line of its own", () => {
    const html = renderToStaticMarkup(React.createElement(NoteLine, { note: CURRY }));
    expect(html).toMatch(/^<span class="mt-1 flex min-w-0 items-center gap-1\.5 text-\[13px\]/);
    expect(html).toContain('aria-hidden="true"');
  });
});

// ── The item page: show, change, Undo ─────────────────────────────

class FakeCache implements CacheLike {
  readonly rows: [CacheKey, unknown][] = [];
  constructor(rows: [CacheKey, unknown][]) {
    this.rows.push(...rows);
  }
  entries(prefix: CacheKey): ReadonlyArray<readonly [CacheKey, unknown]> {
    return this.rows.filter(([k]) => prefix.every((p, i) => JSON.stringify(p) === JSON.stringify(k[i])));
  }
  get(key: CacheKey): unknown {
    return this.rows.find(([k]) => JSON.stringify(k) === JSON.stringify(key))?.[1];
  }
  set(key: CacheKey, data: unknown): void {
    const at = this.rows.findIndex(([k]) => JSON.stringify(k) === JSON.stringify(key));
    if (at >= 0) this.rows[at] = [key, data];
    else this.rows.push([key, data]);
  }
}

const card = (props: Partial<React.ComponentProps<typeof ItemNoteCard>>) =>
  renderToStaticMarkup(
    React.createElement(ItemNoteCard, { note: CURRY, pantry: { kind: "group", name: "Flat 4B" }, canEdit: true, onSave: () => undefined, ...props }),
  );

describe("the item page's note", () => {
  it("may be changed as any edit may: your own item; in a group its buyer, an owner or an admin — not a member who didn't buy it, nor a viewer", () => {
    const own = paneer({ pantry: PERSONAL_REF, paidBy: ME });
    const theirs = paneer({ paidBy: ANU });
    expect(canEditNote(own, { meId: ME, role: null, canWrite: true })).toBe(true);
    expect(canEditNote(theirs, { meId: ANU, role: "member", canWrite: true })).toBe(true);
    expect(canEditNote(theirs, { meId: ME, role: "owner", canWrite: true })).toBe(true);
    expect(canEditNote(theirs, { meId: ME, role: "admin", canWrite: true })).toBe(true);
    expect(canEditNote(theirs, { meId: DEV, role: "member", canWrite: true })).toBe(false);
    expect(canEditNote(theirs, { meId: ME, role: "viewer", canWrite: false })).toBe(false);
    expect(canEditNote(paneer({ paidBy: ME }), { meId: ME, role: "viewer", canWrite: false })).toBe(false);
    // Used up or wasted, its note can still change (as its name can); removed, nothing can.
    expect(canEditNote({ ...own, state: "used_up" }, { meId: ME, role: null, canWrite: true })).toBe(true);
    expect(canEditNote({ ...own, state: "removed" }, { meId: ME, role: null, canWrite: true })).toBe(false);
  });

  it("sends only a change: the same note trimmed is none, an empty one clears it", () => {
    expect(noteOf(paneer())).toBe(CURRY);
    expect(noteOf(makeItem({}))).toBeNull();
    expect(noteChange({ note: CURRY }, ` ${CURRY} `)).toBeNull();
    expect(noteChange({ note: CURRY }, "Top shelf")).toEqual({ note: "Top shelf" });
    expect(noteChange({ note: CURRY }, "  ")).toEqual({ note: null });
    expect(noteChange({ note: null }, "")).toBeNull();
    expect(noteChange({}, "Half for Anu")).toEqual({ note: "Half for Anu" });
    expect(noteSavedText("Top shelf")).toBe("Note saved");
    expect(noteSavedText(null)).toBe("Note removed");
  });

  it("shows at once wherever the item is listed, and Undo's patch puts the old note back", () => {
    const item = paneer();
    const other = paneer({ id: "itm_rice", name: "Rice", note: "Old rice" });
    const ref = `org:${FLAT.orgId}:${item.id}`;
    const cache = new FakeCache([
      [qk.kitchenItem(ref), item],
      [qk.kitchenPantryItems("all"), { items: [item, other], truncated: false }],
      [qk.kitchenPantryItems(FLAT.orgId), { items: [other], truncated: false }],
      [qk.kitchenUseSoon(), { soon: [item], expired: [] }],
      [qk.kitchenSearch("pan"), [item]],
      [qk.kitchenUsable(), [other, item]],
      [qk.kitchenPantries(), { pantries: [] }],
    ]);
    const notes = () => [
      (cache.get(qk.kitchenItem(ref)) as KitchenItem).note,
      (cache.get(qk.kitchenPantryItems("all")) as { items: ReachableItem[] }).items.map((i) => i.note),
      (cache.get(qk.kitchenUseSoon()) as { soon: ReachableItem[] }).soon[0]!.note,
      (cache.get(qk.kitchenSearch("pan")) as ReachableItem[])[0]!.note,
      (cache.get(qk.kitchenUsable()) as ReachableItem[]).map((i) => i.note),
    ];
    const untouched = cache.get(qk.kitchenPantryItems(FLAT.orgId));
    applyPatches(cache, notePatches(item.id, { note: "Top shelf" }));
    expect(notes()).toEqual(["Top shelf", ["Top shelf", "Old rice"], "Top shelf", "Top shelf", ["Old rice", "Top shelf"]]);
    // A list without the item is the very object it was.
    expect(cache.get(qk.kitchenPantryItems(FLAT.orgId))).toBe(untouched);
    // The server's answer brings its version.
    applyPatches(cache, notePatches(item.id, { note: "Top shelf", version: 2 }));
    expect((cache.get(qk.kitchenItem(ref)) as KitchenItem).version).toBe(2);
    // Undo.
    applyPatches(cache, notePatches(item.id, { note: CURRY }));
    expect(notes()).toEqual([CURRY, [CURRY, "Old rice"], CURRY, CURRY, ["Old rice", CURRY]]);
  });

  it("says why a change was refused, in one line", () => {
    expect(noteRefusal({ code: "forbidden", message: "Only…", reason: "not_buyer" })).toBe("Only whoever bought it, or an owner or admin, can change it.");
    expect(noteRefusal({ code: "not_found", message: "Not found" })).toBe("You can't change this item any more.");
    expect(
      noteRefusal({ code: "validation_failed", message: "Invalid", details: { fields: { note: ["Must be at most 80 characters"] } } }),
    ).toBe("Must be at most 80 characters");
    expect(noteRefusal({ code: "unavailable", message: "Try again" })).toBe("Try again");
  });

  it("shows the note behind a pencil, with Change for whoever may change it", () => {
    const html = card({});
    expect(html).toContain('id="note-heading"');
    expect(html).toContain("For Sunday&#x27;s curry");
    expect(html).toContain("lucide-pencil");
    expect(html).toContain('aria-label="Change the note"');
    expect(html).toMatch(/min-h-11[^"]*"[^>]*>Change</);
    // Seen, not changed.
    const seen = card({ canEdit: false });
    expect(seen).toContain("For Sunday&#x27;s curry");
    expect(seen).not.toContain("Change");
  });

  it("offers Add a note when there is none, and nothing to whoever may not add one", () => {
    expect(card({ note: null })).toContain("Add a note");
    expect(card({ note: null })).toMatch(/min-h-\[52px\]/);
    expect(card({ note: null, canEdit: false })).toBe("");
  });

  it("changes it in place: the field with who sees it and its count, then Cancel and Save", () => {
    const html = card({ startEditing: true });
    expect(html).toMatch(/<textarea[^>]*maxLength="80"/);
    expect(html).toMatch(/<textarea[^>]*aria-label="Note"/);
    expect(html).toContain("Everyone in Flat 4B sees it");
    expect(html).toContain(">18/80<");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Save<");
    expect(card({ startEditing: true, pantry: { kind: "personal" } })).toContain("Only you see it");
    // Not editable: no field, whatever is asked.
    expect(card({ startEditing: true, canEdit: false })).not.toContain("<textarea");
  });
});
