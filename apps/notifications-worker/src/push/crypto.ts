// Web Push crypto with WebCrypto alone (Cookpool PW-5): no npm push library,
// no Node shims — the same code runs on Workers and under Node's WebCrypto in
// the tests.
//
//   - Payload encryption, RFC 8291 (Message Encryption for Web Push) over
//     RFC 8188's `aes128gcm` content coding: ECDH P-256 with the browser's
//     key, HKDF-SHA-256 with its auth secret, AES-128-GCM, one record.
//     tests/notifications-worker reproduces RFC 8291 Appendix A exactly.
//   - VAPID, RFC 8292: an ES256 JWT (`aud` the push service's origin, `exp`,
//     `sub`) sent as `Authorization: vapid t=<jwt>, k=<public key>`.
//
// Pure: no env, no I/O. Keys arrive as bytes or CryptoKeys.

const encoder = new TextEncoder();

/** RFC 8188 record size we declare: one record, as every push service accepts. */
export const RECORD_SIZE = 4096;
/** The most plaintext one record holds: the record, less the delimiter and the GCM tag. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - 1 - 16;

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const P256_SIGN = { name: "ECDSA", namedCurve: "P-256" } as const;

// ── base64url ────────────────────────────────────────────────

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of a base64url string (padding optional), or null when it is not one. */
export function base64urlDecode(text: string): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null;
  const bare = text.replace(/=+$/, "");
  if (bare.length % 4 === 1) return null;
  const padded = bare.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((bare.length + 3) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A copy backed by its own ArrayBuffer: what every WebCrypto call is given. */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** Is this a P-256 public key in the uncompressed form (65 bytes, 0x04 first)? Shape only. */
export function isUncompressedP256(bytes: Uint8Array | null): bytes is Uint8Array {
  return bytes !== null && bytes.length === 65 && bytes[0] === 0x04;
}

// ── keys ─────────────────────────────────────────────────────

/**
 * ECDH's derive parameters. The runtime reads `public`; the pinned
 * @cloudflare/workers-types spells it `$public`, so the object is typed
 * loosely here, once.
 */
export function ecdhWith(publicKey: CryptoKey): Parameters<SubtleCrypto["deriveBits"]>[0] {
  return { name: "ECDH", public: publicKey } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0];
}

/** Import a P-256 public key (uncompressed, 65 bytes) for ECDH or for verifying ES256. */
export function importP256PublicKey(raw: Uint8Array, use: "ecdh" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buf(raw), use === "ecdh" ? P256 : P256_SIGN, true, use === "ecdh" ? [] : ["verify"]);
}

/**
 * Import a P-256 private key from its 32-byte scalar `d` and its public point:
 * the form RFC 8291's example and web-push tooling print keys in.
 */
export function importP256PrivateKey(d: Uint8Array, publicRaw: Uint8Array, use: "ecdh" | "sign"): Promise<CryptoKey> {
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64urlEncode(publicRaw.slice(1, 33)),
    y: base64urlEncode(publicRaw.slice(33, 65)),
    d: base64urlEncode(d),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, use === "ecdh" ? P256 : P256_SIGN, false, use === "ecdh" ? ["deriveBits"] : ["sign"]);
}

/** Import an ES256 signing key from PKCS#8 DER (what the VAPID_PRIVATE_KEY secret decodes to). */
export function importPkcs8SigningKey(der: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", buf(der), P256_SIGN, false, ["sign"]);
}

// ── RFC 8291: the payload ────────────────────────────────────

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** The application server's side of one message: its ECDH key pair, fresh per message. */
export interface ServerKeys {
  /** Uncompressed, 65 bytes: goes in the header as the keyid. */
  publicKey: Uint8Array;
  privateKey: CryptoKey;
}

export async function generateServerKeys(): Promise<ServerKeys> {
  const pair = (await crypto.subtle.generateKey(P256, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { publicKey, privateKey: pair.privateKey };
}

/** RFC 8291 §3.3–3.4's derived values (exported for the Appendix A test). */
export interface WebPushSecrets {
  ecdhSecret: Uint8Array;
  ikm: Uint8Array;
  cek: Uint8Array;
  nonce: Uint8Array;
}

export async function deriveWebPushSecrets(
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  salt: Uint8Array,
  server: ServerKeys,
): Promise<WebPushSecrets> {
  const uaKey = await importP256PublicKey(uaPublic, "ecdh");
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhWith(uaKey), server.privateKey, 256),
  );
  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = concatBytes(encoder.encode("WebPush: info\0"), uaPublic, server.publicKey);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  return { ecdhSecret, ikm, cek, nonce };
}

export interface EncryptOptions {
  /** 16 random bytes by default; RFC 8291's example fixes it. */
  salt?: Uint8Array;
  /** A fresh key pair by default; RFC 8291's example fixes it. */
  server?: ServerKeys;
}

/**
 * Encrypt `plaintext` to a browser (its `p256dh` key and `auth` secret) as an
 * `aes128gcm` body: salt(16) ‖ rs(4) ‖ idlen(1) ‖ keyid(65) ‖ one record.
 * The record is the plaintext, the 0x02 last-record delimiter and no padding.
 */
export async function encryptWebPush(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array> {
  if (!isUncompressedP256(uaPublic)) throw new Error("p256dh is not an uncompressed P-256 key");
  if (authSecret.length !== 16) throw new Error("auth is not 16 bytes");
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error("payload too large for one record");
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server = options.server ?? (await generateServerKeys());
  const { cek, nonce } = await deriveWebPushSecrets(uaPublic, authSecret, salt, server);

  const key = await crypto.subtle.importKey("raw", buf(cek), { name: "AES-GCM" }, false, ["encrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce), tagLength: 128 }, key, buf(concatBytes(plaintext, Uint8Array.of(0x02)))),
  );

  const header = new Uint8Array(16 + 4 + 1 + server.publicKey.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = server.publicKey.length;
  header.set(server.publicKey, 21);
  return concatBytes(header, record);
}

// ── RFC 8292: VAPID ──────────────────────────────────────────

/** The longest a VAPID token is made to live: 12 hours (RFC 8292 allows up to 24). */
export const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface VapidClaims {
  /** The push service's origin (`https://fcm.googleapis.com`). */
  aud: string;
  /** Seconds since the epoch. */
  exp: number;
  /** `mailto:` the sender, or an https URL. */
  sub: string;
}

function jsonPart(value: unknown): string {
  return base64urlEncode(encoder.encode(JSON.stringify(value)));
}

/** An ES256 JWT over `claims` (WebCrypto's ECDSA signature is already JWS's r ‖ s). */
export async function signEs256Jwt(claims: VapidClaims, privateKey: CryptoKey): Promise<string> {
  const unsigned = `${jsonPart({ typ: "JWT", alg: "ES256" })}.${jsonPart(claims)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, buf(encoder.encode(unsigned))),
  );
  return `${unsigned}.${base64urlEncode(signature)}`;
}

/** The claims of an ES256 JWT whose signature `publicRaw` verifies; null otherwise. */
export async function verifyEs256Jwt(jwt: string, publicRaw: Uint8Array): Promise<Record<string, unknown> | null> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const decode = (part: string): Record<string, unknown> | null => {
    const bytes = base64urlDecode(part);
    if (!bytes) return null;
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const header = decode(h);
  const claims = decode(p);
  const signature = base64urlDecode(s);
  if (!header || header.alg !== "ES256" || !claims || !signature || signature.length !== 64) return null;
  try {
    const key = await importP256PublicKey(publicRaw, "verify");
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, buf(signature), buf(encoder.encode(`${h}.${p}`)));
    return ok ? claims : null;
  } catch {
    return null;
  }
}

/** The origin a VAPID token for this endpoint names as its audience. */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/** `Authorization` for a push request (RFC 8292 §3). */
export function vapidAuthorization(jwt: string, publicKey: string): string {
  return `vapid t=${jwt}, k=${publicKey}`;
}
