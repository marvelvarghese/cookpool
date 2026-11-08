/**
 * Item notes in the app (Cookpool RC-3, cookpool-recipes design §1.5) as
 * pure view-models: the hint under the Note field (who sees it), the numbers
 * beside it, what an edit sends, the toast after one, who may change a note,
 * and the cache patches that show a new note at once (SM-5) everywhere the
 * item is listed. Only the new frame shows notes (`newFrame()`, RC-1): these
 * are the pieces it shows them with. Dependency-free (contract types only),
 * so it is unit-testable.
 */

import { ITEM_NOTE_MAX, itemNoteLength, normalizeItemNote, type KitchenItem, type PantryRef, type ReachableItem } from "@saas/contracts/kitchen";
import { qk } from "@/lib/query-keys";
import type { CacheKey, CachePatch } from "@/lib/optimistic";
import { canManageGroup, type GroupRole } from "./groups";

export { ITEM_NOTE_MAX };

/** The Note field's placeholder (the canvas's `ItemNote`). */
export const NOTE_PLACEHOLDER = "For Sunday's curry";

/** Who sees a note, in the pantry it goes to: you alone, or the whole group. */
export function noteHint(pantry: Pick<PantryRef, "kind"> & { name?: string }): string {
  return pantry.kind === "group" ? `Everyone in ${pantry.name ?? "the group"} sees it` : "Only you see it";
}

/** "18/80": the characters used, as the server counts them. */
export function noteCount(text: string): string {
  return `${itemNoteLength(text.trim())}/${ITEM_NOTE_MAX}`;
}

/** More than the server takes (the field's maxLength counts UTF-16 units, so only a paste can get here). */
export function noteTooLong(text: string): boolean {
  const note = normalizeItemNote(text);
  return note !== null && itemNoteLength(note) > ITEM_NOTE_MAX;
}

/** An item's note, or null — items read before RC-3 carry none. */
export function noteOf(item: { note?: string | null | undefined }): string | null {
  return item.note ?? null;
}

/**
 * The edit a typed note makes: `{ note }` (null clears it), or null when it
 * is what the item already says — Save then sends nothing.
 */
export function noteChange(item: { note?: string | null | undefined }, text: string): { note: string | null } | null {
  const note = normalizeItemNote(text);
  return note === noteOf(item) ? null : { note };
}

/** The Undo toast's words: "Note saved", "Note removed". */
export function noteSavedText(after: string | null): string {
  return after === null ? "Note removed" : "Note saved";
}

/**
 * May the caller change this item's note? As for any item edit (the API's
 * rule): your own item; in a group, whoever bought it, or an owner or admin
 * — never a viewer.
 */
export function canEditNote(
  item: Pick<KitchenItem, "pantry" | "paidBy" | "state">,
  ctx: { meId: string | null; role: GroupRole | null; canWrite: boolean },
): boolean {
  if (item.state === "removed") return false;
  if (item.pantry.kind === "personal") return true;
  if (!ctx.canWrite || ctx.role === "viewer") return false;
  return item.paidBy === ctx.meId || canManageGroup(ctx.role);
}

// ── At once (SM-5) ────────────────────────────────────────────────

/** What a note write changes on the item: its note, and the server's version once it answers. */
export interface NoteFields {
  note: string | null;
  version?: number;
  updatedAt?: string;
}

function withFields<T extends Pick<KitchenItem, "id"> & { note?: string | null | undefined }>(item: T, itemId: string, fields: NoteFields): T {
  return item.id === itemId ? { ...item, ...fields } : item;
}

function listWith<T extends Pick<KitchenItem, "id">>(list: readonly T[], itemId: string, fields: NoteFields): readonly T[] {
  return list.some((i) => i.id === itemId) ? list.map((i) => withFields(i, itemId, fields)) : list;
}

/**
 * Every cached read that shows the item: its page, every pantry list, Home's
 * use-soon strip, search, and the usable and cookable lists — the note (and,
 * once the server has it, its version) changed in place.
 */
export function notePatches(itemId: string, fields: NoteFields): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPantry(),
      update: (data: unknown, key: CacheKey) => {
        if (data === null || typeof data !== "object") return data;
        switch (key[1]) {
          case "item":
            return withFields(data as KitchenItem, itemId, fields);
          case "items": {
            const d = data as { items: ReachableItem[] };
            if (!Array.isArray(d.items)) return data;
            const items = listWith(d.items, itemId, fields);
            return items === d.items ? d : { ...d, items };
          }
          case "useSoon": {
            const d = data as { soon: ReachableItem[]; expired: ReachableItem[] };
            if (!Array.isArray(d.soon) || !Array.isArray(d.expired)) return data;
            const soon = listWith(d.soon, itemId, fields);
            const expired = listWith(d.expired, itemId, fields);
            return soon === d.soon && expired === d.expired ? d : { soon, expired };
          }
          case "search":
          case "usable":
          case "cookable":
            return Array.isArray(data) ? listWith(data as ReachableItem[], itemId, fields) : data;
          default:
            return data;
        }
      },
    },
  ];
}

/** Why a note was refused, in one line. */
export function noteRefusal(error: { code: string; message: string; reason?: string | undefined; details?: Record<string, unknown> | undefined }): string {
  if (error.reason === "not_buyer") return "Only whoever bought it, or an owner or admin, can change it.";
  if (error.code === "not_found") return "You can't change this item any more.";
  const fields = error.details?.["fields"];
  const messages = fields && typeof fields === "object" ? (fields as Record<string, unknown>)["note"] : undefined;
  if (Array.isArray(messages) && typeof messages[0] === "string") return messages[0];
  return error.message;
}
