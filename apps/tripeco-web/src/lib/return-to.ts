// Where to go after signing in (SE4): opening a live split's link signed out
// goes through Sign in and comes back to the link, not to Home. Only a path
// on this app's own origin is ever returned to.

export const RETURN_KEY = "tripeco.returnTo";

/** `raw` if it is a path on this origin ("/live/KTCH2345"), else null. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string" || raw.length > 300) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/^\/(sign-in|auth)(\/|\?|$)/.test(raw)) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  return raw;
}

export function rememberReturn(storage: Pick<Storage, "setItem"> | null, path: string): void {
  const safe = safeReturnPath(path);
  if (!safe || safe === "/") return;
  try {
    storage?.setItem(RETURN_KEY, safe);
  } catch {
    /* private mode: Home after sign-in */
  }
}

/** Read and forget where to go; "/" when nothing (safe) was kept. */
export function takeReturn(storage: Pick<Storage, "getItem" | "removeItem"> | null): string {
  try {
    const raw = storage?.getItem(RETURN_KEY) ?? null;
    storage?.removeItem(RETURN_KEY);
    return safeReturnPath(raw) ?? "/";
  } catch {
    return "/";
  }
}

export function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
