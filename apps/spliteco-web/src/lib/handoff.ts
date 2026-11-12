// Opened from Cookpool (cookpool-spliteco SE3, risk SE-D): Cookpool's "More
// in Spliteco" opens /handoff?code=…&next=/groups/<org>&back=<the Cookpool
// page>. The one-time code becomes this app's own session, the app opens the
// group, and a "← Back to Cookpool" chip returns to the exact page it came
// from — only ever a Cookpool page of this app's own environment.

import { safeReturnPath } from "./return-to";

export const BACK_KEY = "spliteco.backToCookpool";

const WORKERS_DEV = /^cookpool-spliteco-web-(dev|stage|prod)\.cookpool\.workers\.dev$/;
const LOCAL = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/;
const CUSTOM: Record<string, string[]> = { stage: ["https://stage.cookpool.store"], prod: ["https://cookpool.store"], dev: [] };

/** The Cookpool addresses of this app's environment; null for "any local one" on a local host. */
export function cookpoolOriginsFor(host: string): string[] | "local" {
  const hostname = host.toLowerCase().split(":")[0] ?? "";
  const m = WORKERS_DEV.exec(hostname);
  if (m) return [`https://cookpool-web-console-next-${m[1]}.cookpool.workers.dev`, ...(CUSTOM[m[1]!] ?? [])];
  if (LOCAL.test(hostname)) return "local";
  return [];
}

/** `raw` when it is a page of this environment's Cookpool, else null (never another site). */
export function safeBack(raw: string | null | undefined, host: string): string | null {
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const allowed = cookpoolOriginsFor(host);
  if (allowed === "local") {
    if (url.protocol !== "http:" || !LOCAL.test(url.hostname)) return null;
  } else if (!allowed.includes(url.origin)) {
    return null;
  }
  return url.href;
}

/** Where to go once signed in: `/groups/org_…` is the group's page here; any other own path as it is; else Home. */
export function handoffNext(raw: string | null | undefined): string {
  const m = /^\/groups\/(org_[A-Za-z0-9]{1,64})\/?$/.exec(raw ?? "");
  if (m) return `/group?id=${encodeURIComponent(m[1]!)}`;
  return safeReturnPath(raw) ?? "/";
}

export function rememberBack(storage: Pick<Storage, "setItem" | "removeItem"> | null, href: string | null): void {
  try {
    if (href) storage?.setItem(BACK_KEY, href);
    else storage?.removeItem(BACK_KEY);
  } catch {
    /* private mode: no chip */
  }
}

export function readBack(storage: Pick<Storage, "getItem"> | null, host: string): string | null {
  try {
    return safeBack(storage?.getItem(BACK_KEY) ?? null, host);
  } catch {
    return null;
  }
}
