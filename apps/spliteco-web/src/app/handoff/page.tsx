"use client";

// Opened from Cookpool's "More in Spliteco" (SE3): /handoff?code=…&next=…&back=…
// The code is exchanged once for this app's own session (identity-worker
// checks it is 60 seconds old at most, unused, and made for this origin),
// then the app opens `next` with a "Back to Cookpool" chip to `back`. The
// address is scrubbed of the code before anything else happens.

import * as React from "react";
import { useRouter } from "next/navigation";
import { errorText, makeClient, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { handoffNext, rememberBack, safeBack } from "@/lib/handoff";
import { sessionStore } from "@/lib/return-to";

export default function HandoffPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const { setMe } = useMe();
  const [error, setError] = React.useState<string | null>(null);
  const [back, setBack] = React.useState<string | null>(null);
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const next = handoffNext(params.get("next"));
    const backTo = safeBack(params.get("back"), window.location.host);
    window.history.replaceState(null, "", "/handoff");
    rememberBack(sessionStore(), backTo);
    setBack(backTo);
    if (!code) {
      setError("This link is missing its sign-in code. Open Spliteco again from Cookpool.");
      return;
    }
    makeClient(null)
      .auth.exchangeHandoff({ code })
      .then((r) => {
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
            <h1 className="h1">Couldn&apos;t open Spliteco from Cookpool</h1>
            <p className="error" role="alert">{error}</p>
            <button className="btn big" onClick={() => router.replace("/sign-in")}>Sign in</button>
            {back ? (
              <a href={back} className="btn ghost big">
                ← Back to Cookpool
              </a>
            ) : null}
          </>
        ) : (
          <p className="spinner" role="status">Opening Spliteco…</p>
        )}
      </main>
    </div>
  );
}
