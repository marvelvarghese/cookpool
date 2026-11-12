"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/icons";
import { errorText, makeClient, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { sessionStore, takeReturn } from "@/lib/return-to";
import { passkeySignIn, passkeysRunHere } from "@/lib/passkey";

// Sign in with your Cookpool account: an email, then the 6-digit code sent to
// it; Google; or a passkey made in Cookpool (SE3: identity-worker lists this
// app's address as a return target and a passkey origin, and Cookpool's
// /.well-known/webauthn names it as a related origin, so the same passkeys
// work here). From Cookpool's "More in Spliteco" nobody signs in at all: its
// one-time code comes in through /handoff.

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

  const [passkeys, setPasskeys] = React.useState(false);
  React.useEffect(() => setPasskeys(passkeysRunHere()), []);

  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      const r = await passkeySignIn(client);
      if (!r) return;
      setMe(r.user);
      signIn(r.token);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function google() {
    const origin = window.location.origin;
    window.location.assign(makeClient(null).auth.oauthStartUrl("google", `${origin}/auth/callback`));
  }

  // V2SignIn (spliteco-calm SL1): Google and Passkey side by side; the email
  // code is one tap away under "Email me a code".
  const [useEmail, setUseEmail] = React.useState(false);

  return (
    <div className="app">
      <div className="glow a" aria-hidden="true" />
      <main className="page signin">
        <div className="signin-brand">
          <Mark size={64} />
          <h1>Spliteco</h1>
          <span>Split it. Settle it.</span>
        </div>
        {challenge ? (
          <form className="stack" onSubmit={complete}>
            <p className="muted" style={{ margin: 0, textAlign: "center" }}>
              We sent a 6-digit code to <b style={{ color: "var(--text)" }}>{challenge.hint}</b>.
            </p>
            {challenge.debugCode ? (
              <p className="goldbox small" style={{ margin: 0 }}>
                Test address — your code is <b className="money">{challenge.debugCode}</b>
              </p>
            ) : null}
            <input
              className="input signin-input"
              aria-label="Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              style={{ letterSpacing: "0.4em", fontSize: 22, fontWeight: 600, textAlign: "center" }}
            />
            <button className="btn big round" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="linkbtn dim" onClick={() => { setChallenge(null); setCode(""); }}>
              Use another email
            </button>
          </form>
        ) : useEmail ? (
          <form className="stack" onSubmit={start}>
            <input className="input signin-input" aria-label="Email" type="email" autoComplete="email" inputMode="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn big round" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send code"}
            </button>
            <button type="button" className="linkbtn dim" onClick={() => setUseEmail(false)}>
              Back
            </button>
          </form>
        ) : (
          <div className="stack">
            <div className={passkeys ? "grid2" : "stack"}>
              <button type="button" className="signin-google" onClick={google} aria-label="Continue with Google">
                <GoogleG />
                Google
              </button>
              {passkeys ? (
                <button type="button" className="signin-passkey" onClick={() => void passkey()} disabled={busy} aria-label="Use a passkey">
                  <PasskeyIcon />
                  Passkey
                </button>
              ) : null}
            </div>
            <button type="button" className="linkbtn" onClick={() => setUseEmail(true)}>
              Email me a code
            </button>
            <span className="signin-note">Same account as Cookpool</span>
          </div>
        )}
        {error ? <p className="error" role="alert" style={{ textAlign: "center" }}>{error}</p> : null}
      </main>
    </div>
  );
}

function GoogleG() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function PasskeyIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--link)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="4" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9M18 11a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 16v5M18 19h2" />
    </svg>
  );
}
