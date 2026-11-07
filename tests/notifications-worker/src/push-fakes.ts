// Test doubles for Web Push (PW-5): a browser that subscribes and decrypts
// what it is sent, a push service that answers as told and keeps every
// request, a VAPID pair in the forms the worker reads, and in-memory
// repositories with the semantics of the real ones (tests/db checks those
// against SQLite).

import type { PushMessage } from "@saas/contracts/notifications";
import type {
  NotificationsRepository,
  PushSubscriptionsRepository,
  StoredNotificationPreference,
  StoredPushSubscription,
} from "@saas/db/notifications";
import { base64urlDecode, base64urlEncode, ecdhWith } from "@notifications-worker/push/crypto";
import type { VapidLoad } from "@notifications-worker/push/vapid";
import { loadVapidKeys } from "@notifications-worker/push/vapid";

export const SYSTEM_ORG = "00000000-0000-0000-0000-000000000000";

// ── VAPID ────────────────────────────────────────────────────

export interface VapidPair {
  publicKey: string;
  privateKey: string;
}

/** A pair as scripts/vapid-keys.mjs prints it: raw public point and PKCS#8, base64url. */
export async function vapidPair(): Promise<VapidPair> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  return { publicKey: base64urlEncode(publicRaw), privateKey: base64urlEncode(pkcs8) };
}

export function vapidEnv(pair: VapidPair) {
  return { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, EMAIL_FROM_ADDRESS: "no-reply@mail.cookpool.store" };
}

export function keysFor(pair: VapidPair): () => Promise<VapidLoad> {
  return () => loadVapidKeys(vapidEnv(pair));
}

// ── A browser ────────────────────────────────────────────────

export interface Browser {
  endpoint: string;
  /** What PushSubscription.toJSON() gives the app. */
  subscription: { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  /** Decrypt an aes128gcm body sent to this browser (RFC 8291, the receiving side). */
  decrypt(body: Uint8Array): Promise<PushMessage>;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export async function browser(endpoint: string): Promise<Browser> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = new TextEncoder();
  return {
    endpoint,
    subscription: { endpoint, expirationTime: null, keys: { p256dh: base64urlEncode(uaPublic), auth: base64urlEncode(auth) } },
    async decrypt(body) {
      const salt = body.slice(0, 16);
      const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
      const idlen = body[20]!;
      const asPublic = body.slice(21, 21 + idlen);
      const record = body.slice(21 + idlen);
      if (rs !== 4096 || idlen !== 65 || record.length > rs) throw new Error("not one aes128gcm record");
      const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(asKey), pair.privateKey, 256));
      const ikm = await hkdf(auth, ecdh, cat(text.encode("WebPush: info\0"), uaPublic, asPublic), 32);
      const cek = await hkdf(salt, ikm, text.encode("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, ikm, text.encode("Content-Encoding: nonce\0"), 12);
      const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, record));
      if (plain[plain.length - 1] !== 0x02) throw new Error("no last-record delimiter");
      return JSON.parse(new TextDecoder().decode(plain.slice(0, -1))) as PushMessage;
    },
  };
}

// ── A push service ───────────────────────────────────────────

export interface PushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface PushService {
  fetch: typeof fetch;
  requests: PushRequest[];
  /** Answer this endpoint with this status from now on (default 201). */
  answer(endpoint: string, status: number | "network_error"): void;
}

export function pushService(): PushService {
  const answers = new Map<string, number | "network_error">();
  const requests: PushRequest[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const raw = init?.body;
    const body = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : new Uint8Array();
    requests.push({ endpoint, headers, body });
    const answer = answers.get(endpoint) ?? 201;
    if (answer === "network_error") throw new TypeError("fetch failed");
    return new Response(answer === 201 ? "" : "nope", { status: answer });
  }) as typeof fetch;
  return { fetch: fake, requests, answer: (endpoint, status) => answers.set(endpoint, status) };
}

/**
 * The body sent to one endpoint. A fan-out encrypts for every device at once,
 * so requests reach the push service in whatever order their WebCrypto jobs
 * finish (PW-10): find a device's body by its endpoint, never by position.
 */
export function bodyFor(service: PushService, endpoint: string): Uint8Array {
  const sent = service.requests.filter((r) => r.endpoint === endpoint);
  if (sent.length !== 1) throw new Error(`${sent.length} requests to ${endpoint}, not one`);
  return sent[0]!.body;
}

/** The claims of a VAPID Authorization header, unverified (the tests verify separately). */
export function vapidHeader(value: string | undefined): { jwt: string; k: string } {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(value ?? "");
  if (!m) throw new Error(`not a vapid header: ${value}`);
  return { jwt: m[1]!, k: m[2]! };
}

export function jwtClaims(jwt: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64urlDecode(jwt.split(".")[1]!)!)) as Record<string, unknown>;
}

// ── Repositories ─────────────────────────────────────────────

export function memorySubscriptions(): PushSubscriptionsRepository & { rows: Map<string, StoredPushSubscription> } {
  const rows = new Map<string, StoredPushSubscription>(); // by endpoint
  let seq = 0;
  return {
    rows,
    async upsert(input) {
      const existing = rows.get(input.endpoint);
      const moved = existing && existing.subjectId !== input.subjectId;
      const row: StoredPushSubscription = {
        id: existing?.id ?? input.id,
        subjectId: input.subjectId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        createdAt: existing && !moved ? existing.createdAt : input.now,
        updatedAt: new Date(input.now.getTime() + seq++ / 1000),
        lastSuccessAt: existing && !moved ? existing.lastSuccessAt : null,
        lastFailureAt: null,
        lastFailureReason: null,
      };
      rows.set(input.endpoint, row);
      const mine = [...rows.values()]
        .filter((r) => r.subjectId === input.subjectId)
        .sort((a, b) => Number(b.endpoint === input.endpoint) - Number(a.endpoint === input.endpoint) || b.updatedAt.getTime() - a.updatedAt.getTime());
      const dropped = mine.slice(input.maxPerSubject);
      for (const r of dropped) rows.delete(r.endpoint);
      return { ok: true, value: { subscription: row, dropped: dropped.length } };
    },
    async listForSubject(subjectId) {
      return { ok: true, value: [...rows.values()].filter((r) => r.subjectId === subjectId) };
    },
    async deleteForSubject(subjectId, endpoint) {
      const row = rows.get(endpoint);
      if (!row || row.subjectId !== subjectId) return { ok: true, value: false };
      rows.delete(endpoint);
      return { ok: true, value: true };
    },
    async deleteGone(id, endpoint) {
      const row = rows.get(endpoint);
      if (!row || row.id !== id) return { ok: true, value: false };
      rows.delete(endpoint);
      return { ok: true, value: true };
    },
    async recordSuccess(id, at) {
      for (const r of rows.values()) if (r.id === id) r.lastSuccessAt = at;
      return { ok: true, value: undefined };
    },
    async recordFailure(id, at, reason) {
      for (const r of rows.values()) if (r.id === id) Object.assign(r, { lastFailureAt: at, lastFailureReason: reason });
      return { ok: true, value: undefined };
    },
  };
}

/** Preferences only: what push reads. */
export function memoryPrefs(): Pick<NotificationsRepository, "listPreferences"> & {
  set(subjectId: string, channel: "email" | "push", kinds: Record<string, boolean | null>, orgId?: string): void;
} {
  const rows: StoredNotificationPreference[] = [];
  return {
    set(subjectId, channel, kinds, orgId = SYSTEM_ORG) {
      rows.push({
        id: `pref_${rows.length}`,
        orgId,
        subjectKind: "user",
        subjectId,
        channel,
        categories: {},
        kinds,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
    async listPreferences(orgId, subjectKind, subjectId, channel) {
      return {
        ok: true,
        value: rows.filter((r) => r.orgId === orgId && r.subjectKind === subjectKind && r.subjectId === subjectId && (!channel || r.channel === channel)),
      };
    },
  };
}
