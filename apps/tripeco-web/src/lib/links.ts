// Tripeco ↔ Spliteco addresses (tripeco TR-5). Tripeco signs in through
// Spliteco: Spliteco's /handoff/out makes a one-time code for this exact
// origin and sends you to /handoff here. Only this environment's Spliteco is
// ever used. Pure.

const WORKERS_DEV = /^cookpool-tripeco-web-(dev|stage|prod)\.cookpool\.workers\.dev$/;
const LOCAL = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/;

/** Spliteco's origin for a Tripeco page on `host`; its dev server locally; null elsewhere. */
export function splitecoOriginFor(host: string): string | null {
  const hostname = host.toLowerCase().split(":")[0] ?? "";
  const m = WORKERS_DEV.exec(hostname);
  if (m) return `https://cookpool-spliteco-web-${m[1]}.cookpool.workers.dev`;
  if (LOCAL.test(hostname)) return "http://localhost:3002";
  return null;
}

/** "Continue with Spliteco": Spliteco's /handoff/out for this origin, carrying where to go next. */
export function signInViaSplitecoUrl(origin: string, host: string, next: string | null): string | null {
  const spliteco = splitecoOriginFor(host);
  if (!spliteco) return null;
  const url = new URL("/handoff/out", spliteco);
  url.searchParams.set("to", origin);
  if (next && next !== "/") url.searchParams.set("next", next);
  return url.toString();
}

/** A group in Spliteco ("Open in Spliteco", "Settle", "New"). */
export function splitecoGroupUrl(host: string, groupId: string | null): string | null {
  const spliteco = splitecoOriginFor(host);
  if (!spliteco) return null;
  return groupId ? `${spliteco}/group?id=${encodeURIComponent(groupId)}` : `${spliteco}/groups`;
}

/** `/ride?id=trp_…` from Spliteco's Edit in Tripeco, else a safe own path; null otherwise. */
export function handoffNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.length > 200 || /[\u0000-\u001f\\]/.test(raw)) return "/";
  if (/^\/(sign-in|handoff)(\/|\?|$)/.test(raw)) return "/";
  return raw;
}

export const REMEMBERED_KEY = "tripeco.lastAccount";

/** The first name of the account this device last signed in with, for "Continue as Rahul". */
export function rememberedName(storage: Pick<Storage, "getItem"> | null): string | null {
  try {
    const raw = storage?.getItem(REMEMBERED_KEY) ?? null;
    return raw && raw.length <= 40 ? raw : null;
  } catch {
    return null;
  }
}

export function rememberName(storage: Pick<Storage, "setItem"> | null, displayName: string | null | undefined, email: string): void {
  const first = (displayName ?? "").trim().split(/\s+/)[0] || email.split("@")[0] || "";
  try {
    if (first) storage?.setItem(REMEMBERED_KEY, first.slice(0, 40));
  } catch {
    /* private mode */
  }
}
