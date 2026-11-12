import { uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

// Ids cross the API as `<prefix>_<32 hex>` (a UUID without its dashes) and are
// stored as bare UUIDs. `org_` is the group; the kitchen's own resources take
// the prefixes design.md §1.2 gives them.

export type KitchenIdPrefix =
  | "org" // a group (membership organization)
  | "itm" // an item in a pantry
  | "mov" // a stock move
  | "dsh" // a dish
  | "dsr" // a share of a dish
  | "txn" // a ledger transaction
  | "flg" // a flag on a transaction
  | "msr" // a measure an item's name is counted in (SM-13)
  | "rcp" // a recipe (RC-4)
  | "tmr" // a timer (GC-3)
  | "pur" // a shopping run's purchase (PN-3)
  | "ask" // an ask to use an ask-first item (PN-8)
  | "pst" // a post (CM-3)
  | "cmt" // a comment on a post (CM-3)
  | "rpt" // a report (CM-3)
  | "act" // an Activity row (CM-3)
  | "stp" // an Always have staple (RV-21)
  | "shp"; // a hand-added shopping list line (RV-21)

export function generateRequestId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, "0");
  }
  return `req_${hex}`;
}

export function toPublicId(prefix: KitchenIdPrefix, uuid: string): string {
  return `${prefix}_${uuidToHex(uuid)}`;
}

/** Decode `<prefix>_<32 hex>`; null when the prefix or the hex body is wrong. */
export function parsePublicId(prefix: KitchenIdPrefix, publicId: string): Uuid | null {
  return uuidFromPublicId(publicId, prefix);
}

export function orgPublicId(uuid: string): string {
  return toPublicId("org", uuid);
}

export function parseOrgPublicId(publicId: string): Uuid | null {
  return parsePublicId("org", publicId);
}
