// The VAPID key pair (Cookpool PW-5), read from the environment once per
// isolate and checked before any push is sent.
//
//   VAPID_PUBLIC_KEY    var:    base64url, uncompressed P-256 point (65 bytes)
//   VAPID_PRIVATE_KEY   secret: base64url (no padding) of the PKCS#8 DER
//   EMAIL_FROM_ADDRESS  var:    the token's `sub` is mailto: this address
//
// `apps/notifications-worker/scripts/vapid-keys.mjs` prints a pair in exactly
// these forms. Fails closed: anything missing, malformed or not a pair turns
// push off — GET …/push-key answers `publicKey: null`, no push is sent, email
// is unaffected — with one log line per isolate naming what is wrong (never a
// key).

import type { Env } from "../env.js";
import { base64urlDecode, importP256PublicKey, importPkcs8SigningKey, isUncompressedP256 } from "./crypto.js";

export interface VapidKeys {
  /** As configured: what the app subscribes with and the `k=` of every request. */
  publicKey: string;
  publicRaw: Uint8Array;
  privateKey: CryptoKey;
  /** `mailto:` the sender address. */
  subject: string;
}

export type VapidProblem =
  | "missing_public_key"
  | "missing_private_key"
  | "missing_subject"
  | "invalid_public_key"
  | "invalid_private_key"
  | "keys_not_a_pair";

export type VapidLoad = { ok: true; keys: VapidKeys } | { ok: false; problem: VapidProblem };

const MESSAGES: Record<VapidProblem, string> = {
  missing_public_key: "VAPID_PUBLIC_KEY is not set",
  missing_private_key: "VAPID_PRIVATE_KEY is not set",
  missing_subject: "EMAIL_FROM_ADDRESS is not set (the VAPID subject is mailto: it)",
  invalid_public_key: "VAPID_PUBLIC_KEY is not a base64url uncompressed P-256 key",
  invalid_private_key: "VAPID_PRIVATE_KEY is not a base64url PKCS#8 P-256 key",
  keys_not_a_pair: "VAPID_PRIVATE_KEY does not sign for VAPID_PUBLIC_KEY",
};

let cached: { key: string; load: Promise<VapidLoad> } | null = null;
const logged = new Set<string>();

async function load(env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "EMAIL_FROM_ADDRESS">): Promise<VapidLoad> {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const from = env.EMAIL_FROM_ADDRESS?.trim() ?? "";
  if (!publicKey) return { ok: false, problem: "missing_public_key" };
  if (!privateKey) return { ok: false, problem: "missing_private_key" };
  if (!from) return { ok: false, problem: "missing_subject" };

  const publicRaw = base64urlDecode(publicKey);
  if (!isUncompressedP256(publicRaw)) return { ok: false, problem: "invalid_public_key" };
  let verifyKey: CryptoKey;
  try {
    verifyKey = await importP256PublicKey(publicRaw, "verify");
  } catch {
    return { ok: false, problem: "invalid_public_key" };
  }
  const der = base64urlDecode(privateKey);
  if (!der) return { ok: false, problem: "invalid_private_key" };
  let signingKey: CryptoKey;
  try {
    signingKey = await importPkcs8SigningKey(der);
  } catch {
    return { ok: false, problem: "invalid_private_key" };
  }
  // A pair: what the private key signs, the public key verifies.
  try {
    const probe = new TextEncoder().encode("cookpool vapid pair check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, probe);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, signature, probe);
    if (!ok) return { ok: false, problem: "keys_not_a_pair" };
  } catch {
    return { ok: false, problem: "keys_not_a_pair" };
  }
  return { ok: true, keys: { publicKey, publicRaw, privateKey: signingKey, subject: `mailto:${from}` } };
}

/**
 * The environment's VAPID keys, checked; cached per isolate for the values
 * it was given (a redeploy with new keys reads them afresh).
 */
export function loadVapidKeys(env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "EMAIL_FROM_ADDRESS">): Promise<VapidLoad> {
  const key = `${env.VAPID_PUBLIC_KEY ?? ""}\u0000${env.VAPID_PRIVATE_KEY ?? ""}\u0000${env.EMAIL_FROM_ADDRESS ?? ""}`;
  if (!cached || cached.key !== key) cached = { key, load: load(env) };
  return cached.load;
}

/** Say once per isolate why push is off. Names the variable, never its value. */
export function logPushOff(problem: VapidProblem): void {
  if (logged.has(problem)) return;
  logged.add(problem);
  console.warn(`[notifications-worker] Web Push is off: ${MESSAGES[problem]}. Email is unaffected.`);
}
