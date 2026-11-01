import { hexToUuid, uuidToHex, uuidFromPublicId, type Uuid } from "@saas/db/ids";
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}



export function generateRequestId(): string {
  return `req_${randomHex(12)}`;
}

export function orgPublicId(uuid: string): string {
  return `org_${uuidToHex(uuid)}`;
}

export function parseOrgPublicId(id: string): Uuid | null {
  return uuidFromPublicId(id, "org");
}

export function memberPublicId(uuid: string): string {
  return `mem_${uuidToHex(uuid)}`;
}

export function parseMemberPublicId(publicId: string): string | null {
  if (!publicId.startsWith("mem_")) return null;
  return hexToUuid(publicId.slice(4));
}

export function invitationPublicId(uuid: string): string {
  return `inv_${uuidToHex(uuid)}`;
}

export function parseInvitationPublicId(publicId: string): string | null {
  if (!publicId.startsWith("inv_")) return null;
  return hexToUuid(publicId.slice(4));
}

export async function hashToken(raw: string): Promise<string> {
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  let hash = "";
  for (let i = 0; i < hashArray.length; i++) {
    hash += hashArray[i]!.toString(16).padStart(2, "0");
  }
  return hash;
}

export async function generateInvitationToken(): Promise<{ raw: string; hash: string }> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let raw = "";
  for (let i = 0; i < buf.length; i++) {
    raw += buf[i]!.toString(16).padStart(2, "0");
  }
  const hash = await hashToken(raw);
  return { raw, hash };
}

// Join codes (Cookpool CP-3): 8 characters from an alphabet with no look-alikes
// (no 0/O, 1/I/L), so a code read aloud or copied by hand still works. 31^8 ≈
// 8.5e11 codes, far beyond guessing at the edge's rate limits.
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;
const JOIN_CODE_RE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

export function generateJoinCode(): string {
  // Rejection sampling: 256 is not a multiple of 31, so bytes at or above the
  // largest multiple are dropped to keep every character equally likely.
  const limit = 256 - (256 % JOIN_CODE_ALPHABET.length);
  let code = "";
  while (code.length < JOIN_CODE_LENGTH) {
    const buf = new Uint8Array(JOIN_CODE_LENGTH * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && code.length < JOIN_CODE_LENGTH; i++) {
      const byte = buf[i]!;
      if (byte < limit) code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
    }
  }
  return code;
}

/**
 * Normalize a code as a person might type or paste it (" ktch-2345" →
 * "KTCH2345"): spaces and dashes dropped, upper-cased. Returns null when
 * what is left cannot be a join code, so callers answer "not found" without a
 * database read.
 */
export function normalizeJoinCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, "").toUpperCase();
  return JOIN_CODE_RE.test(code) ? code : null;
}
