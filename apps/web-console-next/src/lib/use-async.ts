"use client";

import * as React from "react";
import type { ApiResult } from "@/lib/api";
import { useSession, readStoredToken } from "@/lib/session";
import { loginPathFor } from "@/lib/safe-next";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: { code: string; message: string } | null;
  reload: () => void;
}

export function useAsync<T>(
  fn: () => Promise<ApiResult<T>>,
  deps: React.DependencyList,
): AsyncState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const [seq, setSeq] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn().then(
      (r) => {
        if (cancelled) return;
        if (r.ok) {
          setData(r.data);
        } else {
          setError({ code: r.error.code, message: r.error.message });
        }
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError({ code: "exception", message: (e as Error).message });
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, seq]);

  return { data, loading, error, reload: () => setSeq((x) => x + 1) };
}

/**
 * Redirects to /login only when there is genuinely no session, and returns
 * whether the session is present.
 *
 * The token is hydrated synchronously from localStorage in the provider, so on a
 * reload/deep-link `token` is already set on the first render. As a belt-and-
 * suspenders guard we also re-check storage directly before redirecting: we
 * never bounce a user who actually has a token, even if context state hasn't
 * propagated yet. This is what prevents the "logged out after every reload" bug.
 *
 * `returnHere` (Cookpool CP-5) sends the person to `/login?next=<this page>` so
 * sign-in brings them back (a join link must survive signing in). Off by
 * default, so the admin console's redirect is unchanged.
 *
 * `signOutOnUnauthorized` (Cookpool SI-5): when the API answers 401 to the
 * session's token, the session has ended — clear the token and send the person
 * to `/login?next=<this page>&expired=1`, which says "You were signed out".
 * With no token at all they never had a session here, so the plain redirect
 * above applies. Off by default: the admin console is unchanged.
 */
export function useRequireAuth(
  opts: { returnHere?: boolean; signOutOnUnauthorized?: boolean } = {},
): boolean {
  const { token, setToken, onUnauthorized } = useSession();
  const [ready, setReady] = React.useState(false);
  const returnHere = opts.returnHere ?? false;
  const signOutOnUnauthorized = opts.signOutOnUnauthorized ?? false;
  // Set once a 401 has sent the person to sign-in, so the no-token redirect
  // below (which the cleared token would trigger) does not race it.
  const leaving = React.useRef(false);

  React.useEffect(() => {
    setReady(true);
    if (typeof window === "undefined" || leaving.current) return;
    if (!token && !readStoredToken()) {
      const { pathname, search, hash } = window.location;
      window.location.href = returnHere ? loginPathFor(`${pathname}${search}${hash}`) : "/login";
    }
  }, [token, returnHere]);

  React.useEffect(() => {
    if (!signOutOnUnauthorized) return;
    return onUnauthorized(() => {
      if (leaving.current) return;
      leaving.current = true;
      const { pathname, search, hash } = window.location;
      const to = loginPathFor(`${pathname}${search}${hash}`, { signedOut: true });
      // The same clearing every sign-out in the console does.
      setToken(null);
      window.location.replace(to);
    });
  }, [signOutOnUnauthorized, onUnauthorized, setToken]);

  return ready && !!token;
}
