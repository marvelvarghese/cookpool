// Spliteco ↔ Tripeco (tripeco TR-5, TR-7). Tripeco signs in with your
// Spliteco account: its "Continue with Spliteco" opens /handoff/out here,
// which mints a one-time code for Tripeco's exact origin (identity-worker's
// HANDOFF_ORIGINS lists it) and sends you back with it. Only the Tripeco of
// this app's own environment is ever a target. A ride row's "Edit in Tripeco"
// opens the ride there (TR-7). Pure.

import { safeReturnPath } from "./return-to";

const WORKERS_DEV = /^cookpool-spliteco-web-(dev|stage|prod)\.cookpool\.workers\.dev$/;
const LOCAL = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/;

/** Tripeco's origin for a Spliteco page on `host`; the local dev server's on a local host; null elsewhere. */
export function tripecoOriginFor(host: string): string | null {
  const hostname = host.toLowerCase().split(":")[0] ?? "";
  const m = WORKERS_DEV.exec(hostname);
  if (m) return `https://cookpool-tripeco-web-${m[1]}.cookpool.workers.dev`;
  if (LOCAL.test(hostname)) return "http://localhost:3003";
  return null;
}

/** `raw` when it is exactly this environment's Tripeco origin (any local one on a local host), else null. */
export function safeTripecoTarget(raw: string | null | undefined, host: string): string | null {
  if (!raw || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== raw.replace(/\/$/, "") || url.username || url.password) return null;
  const hostname = host.toLowerCase().split(":")[0] ?? "";
  if (LOCAL.test(hostname)) return url.protocol === "http:" && LOCAL.test(url.hostname) ? url.origin : null;
  return url.origin === tripecoOriginFor(host) ? url.origin : null;
}

/** Where Tripeco lands with the code: its /handoff, carrying a safe own path to open next. */
export function tripecoHandoffUrl(target: string, code: string, next: string | null): string {
  const url = new URL("/handoff", target);
  url.searchParams.set("code", code);
  const path = safeReturnPath(next);
  if (path) url.searchParams.set("next", path);
  return url.toString();
}

/** "Edit in Tripeco": the ride on this environment's Tripeco, or null where there is none. */
export function tripecoRideHref(host: string, rideId: string): string | null {
  const origin = tripecoOriginFor(host);
  if (!origin || !/^trp_[0-9a-f]{32}$/.test(rideId)) return null;
  return `${origin}/ride?id=${rideId}`;
}
