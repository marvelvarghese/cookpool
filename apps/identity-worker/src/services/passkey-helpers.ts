// Passkeys (Cookpool PK-2): configuration, device names and the small parsing
// the service needs before the WebAuthn library sees a response.

import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { PASSKEY_DEVICE_NAME_MAX, type Passkey } from "@saas/contracts/passkeys";
import type { Passkey as StoredPasskey } from "@saas/db/identity";
import type { Env } from "../env.js";

export interface PasskeyConfig {
  rpId: string;
  rpName: string;
  /** Exact origins; a ceremony from any other is refused. */
  origins: string[];
}

/**
 * The passkey configuration, or null when passkeys are off here: an empty
 * PASSKEY_RP_ID (the design's switch), or no origin to accept.
 */
export function passkeyConfig(env: Pick<Env, "PASSKEY_RP_ID" | "PASSKEY_RP_NAME" | "PASSKEY_ORIGINS">): PasskeyConfig | null {
  const rpId = (env.PASSKEY_RP_ID ?? "").trim();
  if (!rpId) return null;
  const origins = (env.PASSKEY_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length === 0) return null;
  return { rpId, rpName: (env.PASSKEY_RP_NAME ?? "").trim() || "Cookpool", origins };
}

export const KNOWN_TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"] as const;
type Transport = (typeof KNOWN_TRANSPORTS)[number];

/** Known transport names only, once each. */
export function cleanTransports(raw: unknown): Transport[] {
  if (!Array.isArray(raw)) return [];
  return KNOWN_TRANSPORTS.filter((t) => raw.includes(t));
}

/**
 * A name for a passkey the person did not name: the device from the user
 * agent, or a security key / phone from the transports.
 */
export function deviceNameFor(transports: readonly string[], userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const roaming = transports.length > 0 && !transports.includes("internal");
  if (roaming && transports.includes("hybrid")) return "Phone";
  if (roaming && transports.some((t) => t === "usb" || t === "nfc" || t === "ble" || t === "smart-card")) {
    return "Security key";
  }
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux computer";
  return "Passkey";
}

/** Printable, no control characters. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** A device name the person gave: trimmed, 1–60 characters. Undefined when none was given; null when it is wrong. */
export function parseDeviceName(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > PASSKEY_DEVICE_NAME_MAX || CONTROL_RE.test(name)) return null;
  return name;
}

/**
 * The fields every WebAuthn response JSON has, checked before anything else
 * reads it, and the challenge its clientDataJSON carries. Null when it is not
 * that shape; the library checks the rest.
 */
export function readCeremony(raw: unknown): { id: string; challenge: string; userHandle: string | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
  if (typeof r.id !== "string" || !r.id || r.id.length > 1366 || r.id !== r.rawId || r.type !== "public-key") return null;
  if (!isoBase64URL.isBase64URL(r.id)) return null;
  if (!r.response || typeof r.response !== "object") return null;
  const inner = r.response as { clientDataJSON?: unknown; userHandle?: unknown };
  if (typeof inner.clientDataJSON !== "string" || !isoBase64URL.isBase64URL(inner.clientDataJSON)) return null;
  let challenge: unknown;
  try {
    challenge = (JSON.parse(isoBase64URL.toUTF8String(inner.clientDataJSON)) as { challenge?: unknown }).challenge;
  } catch {
    return null;
  }
  if (typeof challenge !== "string" || !challenge || challenge.length > 256) return null;
  const userHandle = typeof inner.userHandle === "string" && inner.userHandle ? inner.userHandle : null;
  return { id: r.id, challenge, userHandle };
}

/** The WebAuthn user handle for a user: the 16 bytes of their UUID. No email, no name. */
export function userHandleBytes(userUuid: string): Uint8Array<ArrayBuffer> {
  const hex = userUuid.replace(/-/g, "").toLowerCase();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function userHandleFor(userUuid: string): string {
  return isoBase64URL.fromBuffer(userHandleBytes(userUuid));
}

export function toPasskey(p: StoredPasskey): Passkey {
  return {
    id: p.id,
    deviceName: p.deviceName,
    createdAt: p.createdAt.toISOString(),
    lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
    backedUp: p.backedUp,
  };
}
