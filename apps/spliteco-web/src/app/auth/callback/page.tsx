"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { sessionStore, takeReturn } from "../../../lib/return-to";
import { useSession } from "../../../lib/session";

// Where Google returns:
// identity-worker redirects here with `#token=…` or `#error=…` in the
// fragment, as it does for the console. The fragment is read once and scrubbed.

const ERROR_COPY: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  email_required: "Your Google account has no email. Sign in with an email code instead.",
  email_unverified: "Your Google email isn't verified. Sign in with an email code instead.",
  provider_unavailable: "Google sign-in is unavailable right now.",
};

export default function OAuthCallbackPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const [error, setError] = React.useState<string | null>(null);
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    window.history.replaceState(null, "", window.location.pathname);
    const token = params.get("token");
    if (token) {
      signIn(token);
      router.replace(takeReturn(sessionStore()));
      return;
    }
    setError(ERROR_COPY[params.get("error") ?? ""] ?? "Something went wrong during sign-in. Please try again.");
  }, [router, signIn]);

  return (
    <div className="app">
      <main className="page" style={{ minHeight: "100dvh", justifyContent: "center" }}>
        {error ? (
          <>
            <h1 className="h1">Sign-in didn&apos;t finish</h1>
            <p className="error" role="alert">{error}</p>
            <button className="btn big" onClick={() => router.replace("/sign-in")}>Back to sign in</button>
          </>
        ) : (
          <p className="spinner" role="status">Signing you in…</p>
        )}
      </main>
    </div>
  );
}
