"use client";

// Signing in to Tripeco with this account (tripeco TR-5):
// /handoff/out?to=<Tripeco's origin>&next=<a Tripeco path>. Signed in, a
// one-time code is made for exactly that origin and you go straight back;
// signed out, Sign in first, then back here. Only this environment's Tripeco
// is a target (lib/tripeco-link.ts).

import * as React from "react";
import { useRouter } from "next/navigation";
import { errorText, useSession } from "../../../lib/session";
import { rememberReturn, sessionStore } from "../../../lib/return-to";
import { safeTripecoTarget, tripecoHandoffUrl } from "../../../lib/tripeco-link";

export default function HandoffOutPage() {
  const router = useRouter();
  const { ready, token, client } = useSession();
  const [error, setError] = React.useState<string | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!ready || started.current) return;
    const params = new URLSearchParams(window.location.search);
    const target = safeTripecoTarget(params.get("to"), window.location.host);
    if (!target) {
      started.current = true;
      setError("That link isn't for this app's Tripeco.");
      return;
    }
    if (!token) {
      started.current = true;
      rememberReturn(sessionStore(), `/handoff/out${window.location.search}`);
      router.replace("/sign-in");
      return;
    }
    started.current = true;
    client.auth
      .createHandoff({ targetOrigin: target })
      .then((r) => window.location.replace(tripecoHandoffUrl(target, r.code, params.get("next"))))
      .catch((err) => setError(errorText(err)));
  }, [ready, token, client, router]);

  return (
    <div className="app">
      <main className="page" style={{ minHeight: "100dvh", justifyContent: "center" }}>
        {error ? (
          <>
            <h1 className="h1">Couldn&apos;t open Tripeco</h1>
            <p className="error" role="alert">{error}</p>
            <button className="btn big" onClick={() => router.replace("/")}>Home</button>
          </>
        ) : (
          <p className="spinner" role="status">Opening Tripeco…</p>
        )}
      </main>
    </div>
  );
}
