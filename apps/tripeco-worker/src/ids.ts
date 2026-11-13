import { uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

// Tripeco's own ids are stored with their prefix (`veh_`, `ful_`, `trp_`,
// `pho_` and 32 hex). Spliteco's group and expense ids cross the API as
// `org_…` / `txn_…` and are stored as bare UUIDs, as Spliteco stores them.

export type TripecoPrefix = "veh" | "ful" | "trp" | "pho";

export function newId(prefix: TripecoPrefix): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

const OWN_ID_RE = /^(veh|ful|trp|pho)_[0-9a-f]{32}$/;

/** `<prefix>_<32 hex>` of the given prefix, else null. */
export function parseOwnId(prefix: TripecoPrefix, raw: string): string | null {
  return OWN_ID_RE.test(raw) && raw.startsWith(`${prefix}_`) ? raw : null;
}

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export const orgPublicId = (uuid: string): string => `org_${uuidToHex(uuid)}`;
export const txnPublicId = (uuid: string): string => `txn_${uuidToHex(uuid)}`;
export const parseOrgPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "org");
export const parseTxnPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "txn");
