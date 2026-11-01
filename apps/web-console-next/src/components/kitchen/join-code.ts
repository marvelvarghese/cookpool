/**
 * Join codes and links on the client (Cookpool CP-5). Pure and
 * dependency-free so it is unit-testable.
 *
 * A group's join link is `<origin>/join/<code>`. People paste either the whole
 * link or just the code, typed any way ("ktch-2345", "KTCH 2345"); this file
 * finds the code and normalizes it exactly as the membership worker does
 * (`apps/membership-worker/src/ids.ts`: spaces and dashes dropped, upper-cased,
 * 8 characters from an alphabet without look-alikes), so a code the server
 * would refuse never makes a request.
 */

/** Mirrors `JOIN_CODE_ALPHABET` in apps/membership-worker/src/ids.ts. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Mirrors `JOIN_CODE_LENGTH` in apps/membership-worker/src/ids.ts. */
export const JOIN_CODE_LENGTH = 8;

const JOIN_CODE_RE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** The server's normalization: `" ktch-2345"` → `"KTCH2345"`, or null. */
export function normalizeJoinCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, "").toUpperCase();
  return JOIN_CODE_RE.test(code) ? code : null;
}

/**
 * The join code in what someone pasted: a full link
 * (`https://host/join/KTCH-2345?ref=x`), a bare path (`/join/ktch2345`), a
 * link without a scheme (`host/join/KTCH2345`), or the code on its own.
 * Only the code is kept — the host of a pasted link is ignored, so joining
 * always happens on this app. Null when nothing in it can be a code.
 */
export function extractJoinCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;

  const match = /(?:^|\/)join\/([^/?#]*)/i.exec(value);
  const candidate = match ? safeDecode(match[1] ?? "") : value;
  return normalizeJoinCode(candidate);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A code as people read it aloud: `KTCH2345` → `KTCH-2345`. */
export function formatJoinCode(code: string): string {
  if (code.length !== JOIN_CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The in-app path of a join link. */
export function joinPath(code: string): string {
  return `/join/${encodeURIComponent(code)}`;
}

/** The shareable join link on `origin` (e.g. `window.location.origin`). */
export function joinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${joinPath(code)}`;
}

/** What the join page shows when joining did not work. */
export type JoinFailure = "not_found" | "full" | "too_many_groups" | "error";

/**
 * Classify a failed preview or join (`wrap()`'s error and HTTP status): an
 * unknown or rotated code is `not_found`; a 412 is a full group, or — with
 * `reason: "groups_per_person"` — a person already in the most groups allowed.
 */
export function joinFailureKind(
  error: { code: string; reason?: string | undefined },
  status: number,
): JoinFailure {
  if (status === 404 || error.code === "not_found") return "not_found";
  if (status === 412 || error.code === "precondition_failed") {
    return error.reason === "groups_per_person" ? "too_many_groups" : "full";
  }
  return "error";
}
