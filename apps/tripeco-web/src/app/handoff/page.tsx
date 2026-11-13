"use client";

// Back from Spliteco's /handoff/out (tripeco TR-5): /handoff?code=…&next=…
// The one-time code becomes this app's own session (identity-worker checks it
// is fresh, unused and made for this origin), then `next` opens. The code is
// scrubbed from the address first.

import * as React from "react";
import { useRouter } from "next/navigation";
import { errorText, makeClient, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { handoffNext, rememberName } from "@/lib/links";

export default function HandoffPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const { setMe } = useMe();
  const [error, setError] = React.useState<string | null>(null);
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const next = handoffNext(params.get("next"));
    window.history.replaceState(null, "", "/handoff");
    if (!code) {
      setError("This link has no sign-in code");
      return;
    }
    makeClient(null)
      .auth.exchangeHandoff({ code })
      .then((r) => {
        try {
          rememberName(window.localStorage, r.user.displayName, r.user.email);
        } catch {
          /* private mode */
        }
        setMe(r.user);
        signIn(r.token);
        router.replace(next);
      })
      .catch((err) => setError(errorText(err)));
  }, [router, signIn, setMe]);

  return (
    <div className="app">
      <main className="page" style={{ minHeight: "100dvh", justifyContent: "center" }}>
        {error ? (
          <>
            <p className="error" role="alert">{error}</p>
            <button className="btn" onClick={() => router.replace("/sign-in")}>Sign in</button>
          </>
        ) : (
          <p className="spinner" role="status">Signing in…</p>
        )}
      </main>
    </div>
  );
}
