import { uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

// Ids cross the API as `<prefix>_<32 hex>` (a UUID without its dashes) and are
// stored as bare UUIDs: `org_` a group, `txn_` a ledger row, `cmt_` a comment
// (comments are stored with their prefix, as ledger_comments.id requires).

export type SplitecoIdPrefix = "org" | "txn" | "cmt" | "itm" | "dsh";

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function toPublicId(prefix: SplitecoIdPrefix, uuid: string): string {
  return `${prefix}_${uuidToHex(uuid)}`;
}

/** Decode `<prefix>_<32 hex>`; null when the prefix or the hex body is wrong. */
export function parsePublicId(prefix: SplitecoIdPrefix, publicId: string): Uuid | null {
  return uuidFromPublicId(publicId, prefix);
}

export const orgPublicId = (uuid: string): string => toPublicId("org", uuid);
export const txnPublicId = (uuid: string): string => toPublicId("txn", uuid);
export const parseOrgPublicId = (id: string): Uuid | null => parsePublicId("org", id);
export const parseTxnPublicId = (id: string): Uuid | null => parsePublicId("txn", id);

/** A fresh comment id, stored as is. */
export function newCommentId(): string {
  return `cmt_${crypto.randomUUID().replace(/-/g, "")}`;
}
