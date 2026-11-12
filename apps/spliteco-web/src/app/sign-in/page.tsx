"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/icons";
import { errorText, makeClient, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { sessionStore, takeReturn } from "@/lib/return-to";

// Sign in with your Cookpool account: an email, then the 6-digit code sent to
// it. Google is offered only on a build with NEXT_PUBLIC_SPLITECO_GOOGLE=on —
// identity-worker must first allow this app's address as a return target.
// Passkeys are not offered yet (identity's PASSKEY_ORIGINS names Cookpool's
// address only).

const GOOGLE = process.env.NEXT_PUBLIC_SPLITECO_GOOGLE === "on";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, token, ready } = useSession();
  const { setMe } = useMe();
  const [email, setEmail] = React.useState("");
  const [challenge, setChallenge] = React.useState<{ id: string; hint: string; debugCode?: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (ready && token) router.replace(takeReturn(sessionStore()));
  }, [ready, token, router]);

  const client = React.useMemo(() => makeClient(null), []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await client.auth.loginStart({ email: email.trim() });
      setChallenge({ id: r.challengeId, hint: r.delivery.emailHint, ...(r.delivery.mode === "local_debug" && r.delivery.code ? { debugCode: r.delivery.code } : {}) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function complete(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.auth.loginComplete({ challengeId: challenge.id, code: code.trim() });
      setMe(r.user);
      // The effect above goes on (back to where sign-in was asked for) once the token is in.
      signIn(r.token);
    } catch (err) {
      setError(errorText(err) === "Something went wrong. Try again." ? "That code didn't work. Check it and try again." : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function google() {
    const origin = window.location.origin;
    window.location.assign(makeClient(null).auth.oauthStartUrl("google", `${origin}/auth/callback`));
  }

  return (
    <div className="app">
      <div className="glow a" aria-hidden="true" />
      <main className="page" style={{ minHeight: "100dvh", justifyContent: "center", paddingBottom: 40 }}>
        <div className="inline" style={{ gap: 10 }}>
          <Mark size={40} />
          <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Spliteco</span>
        </div>
        <div className="stack s8">
          <h1 className="h1" style={{ fontSize: 30 }}>Split every shared cost</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
            Sign in with your Cookpool account. Every kitchen you&apos;re in is already here as a group.
          </p>
        </div>
        {!challenge ? (
          <form className="stack s14" onSubmit={start}>
            <label className="stack s8">
              <span className="small muted bold">Email</span>
              <input className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <button className="btn big" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
            {GOOGLE ? (
              <button type="button" className="btn ghost big" onClick={google}>
                Continue with Google
              </button>
            ) : null}
          </form>
        ) : (
          <form className="stack s14" onSubmit={complete}>
            <p className="muted" style={{ margin: 0 }}>
              We sent a 6-digit code to <b style={{ color: "var(--text)" }}>{challenge.hint}</b>.
            </p>
            {challenge.debugCode ? (
              <p className="goldbox small" style={{ margin: 0 }}>
                Test address — your code is <b className="money">{challenge.debugCode}</b>
              </p>
            ) : null}
            <label className="stack s8">
              <span className="small muted bold">Code</span>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                style={{ letterSpacing: "0.4em", fontSize: 22, fontWeight: 800 }}
              />
            </label>
            <button className="btn big" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="btn ghost" onClick={() => { setChallenge(null); setCode(""); }}>
              Use another email
            </button>
          </form>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </main>
    </div>
  );
}
