/**
 * Where to send someone after they sign in (Cookpool CP-5).
 *
 * A page that needs a session (a join link, say) sends the person to
 * `/login?next=<path>`; after sign-in they land back on that path. `next`
 * comes from the URL, so it is untrusted: only a path on this origin is
 * accepted, never an absolute or protocol-relative URL that would turn the
 * login page into an open redirect. Pure and dependency-free so it is
 * unit-testable.
 */

/** Where a signed-in person lands when there is no (valid) `next`. */
export const HOME_PATH = "/home";

// Resolution base for the same-origin check. `.invalid` can never resolve.
const BASE_ORIGIN = "https://next.invalid";

/**
 * The same-origin path `raw` names, or null when it is not one. Accepts
 * `/join/KTCH2345?x=1#y`; rejects `https://evil.example`, `//evil.example`,
 * `/\evil.example`, anything with control characters or backslashes, paths
 * that normalize to `//…`, and the sign-in pages themselves (a loop).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  // Browsers read `\` as `/` (so `/\evil.example` is protocol-relative), and
  // control characters are stripped before parsing: refuse both outright.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, BASE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== BASE_ORIGIN) return null;

  const path = `${url.pathname}${url.search}${url.hash}`;
  // `/..//evil.example` normalizes to `//evil.example`: protocol-relative again.
  if (path.startsWith("//")) return null;
  if (isAuthPath(url.pathname)) return null;
  return path;
}

function isAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  );
}

/** The post-sign-in destination: a safe `next`, else Home. */
export function postLoginDestination(rawNext: string | null | undefined): string {
  return safeNextPath(rawNext) ?? HOME_PATH;
}

/**
 * The sign-in URL that returns to `path` afterwards. A path that is not safe,
 * or is the app root or Home (where sign-in lands anyway), gets plain `/login`.
 */
export function loginPathFor(path: string | null | undefined): string {
  const next = safeNextPath(path);
  if (!next || next === "/" || next === HOME_PATH) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

/** The `next` parameter of a query string (`?next=…`), unvalidated. */
export function nextParamFrom(search: string): string | null {
  try {
    return new URLSearchParams(search).get("next");
  } catch {
    return null;
  }
}
