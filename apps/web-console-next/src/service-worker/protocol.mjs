// NO SIGNAL, CLEAN UPDATES (Cookpool PW-4, cookpool-app design §3): what the
// page and its service worker agree on — the names of the worker's caches,
// the messages the page sends it, and the header a cached answer carries.
//
// Plain JavaScript (with protocol.d.mts beside it): the build bundles it into
// `/sw.js` (scripts/service-worker.mjs) and the page imports it. No imports,
// no globals but `crypto` (when hashing) and `TextEncoder`.

/** Every cache the worker makes starts with this; the kill switch deletes them all. */
export const CACHE_PREFIX = "cookpool-";

/** The build's own files, one cache per build id (`cookpool-static-<build id>`). */
export const STATIC_CACHE_PREFIX = "cookpool-static-";

/** The last-seen API reads, one cache per account (`cookpool-data-v1-<subject id>`). */
export const DATA_CACHE_PREFIX = "cookpool-data-";

/** The shape of what a data cache holds; a new version drops the old caches. */
export const DATA_CACHE_VERSION = "v1";

/** Which account the data cache is for: one small record, never a token. */
export const META_CACHE = "cookpool-meta";

/** The key of that record in META_CACHE (a path on the app's origin that nothing serves). */
export const ACCOUNT_PATH = "/__cookpool/account";

/** On an answer the worker gave from the data cache: when it was stored (ISO). */
export const CACHED_AT_HEADER = "x-cookpool-cached-at";

/** The messages the page posts to the worker. */
export const MESSAGE = Object.freeze({
  /** `{ type, subjectId, tokenHash }`: who is signed in, and a SHA-256 of their session's token. */
  account: "cookpool:account",
  /** `{ type }`: nobody is signed in any more; delete every account's data. */
  signedOut: "cookpool:signed-out",
  /** `{ type }`, to the waiting worker: take over now (the person pressed Reload). */
  activate: "cookpool:activate",
  /**
   * `{ type, buildId }`, to the waiting worker, with a port for the answer
   * `{ adopted }`: if that is your build id, the page is your build already
   * (it came from the network while the old worker was in charge): take over
   * without a reload.
   */
  adopt: "cookpool:adopt",
});

/** The precache for one build. */
export function staticCacheName(buildId) {
  return `${STATIC_CACHE_PREFIX}${buildId}`;
}

/** A subject id as the API spells it (`usr_…`): letters, digits, `_` and `-`. */
export function isSubjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** A SHA-256, in lowercase hex. */
export function isTokenHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** The data cache for one account. Throws for anything that is not a subject id. */
export function dataCacheName(subjectId) {
  if (!isSubjectId(subjectId)) throw new TypeError("not a subject id");
  return `${DATA_CACHE_PREFIX}${DATA_CACHE_VERSION}-${subjectId}`;
}

/** The account record's key on `origin`. */
export function accountUrl(origin) {
  return new URL(ACCOUNT_PATH, origin).href;
}

/** The token in an `Authorization: Bearer …` header, else null. */
export function bearerToken(authorization) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  return m ? m[1] : null;
}

/**
 * SHA-256 of a session token, in hex: how the worker tells one session's
 * requests from another's without keeping the token itself anywhere.
 */
export async function tokenHash(token, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  let out = "";
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
  return out;
}
