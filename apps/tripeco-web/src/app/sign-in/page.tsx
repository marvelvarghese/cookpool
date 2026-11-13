"use client";

// Sign in (canvas SignIn): your Spliteco account, in one tap. "Continue with
// Spliteco" (or "Continue as Rahul" once this device has seen you) opens
// Spliteco's /handoff/out, which sends you back to /handoff with a one-time
// code for this origin (design §0.10). "Use another account" is the email
// code, the same account system.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { errorText, makeClient, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { sessionStore, takeReturn } from "@/lib/return-to";
import { rememberName, rememberedName, signInViaSplitecoUrl } from "@/lib/links";
import { initialOf } from "@/lib/people";

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function SignInPage() {
  const router = useRouter();
  const { signIn, token, ready } = useSession();
  const { setMe } = useMe();
  const [name, setName] = React.useState<string | null>(null);
  const [spliteco, setSpliteco] = React.useState<string | null>(null);
  const [other, setOther] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [challenge, setChallenge] = React.useState<{ id: string; hint: string; debugCode?: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const client = React.useMemo(() => makeClient(null), []);

  React.useEffect(() => {
    if (ready && token) router.replace(takeReturn(sessionStore()));
  }, [ready, token, router]);

  React.useEffect(() => {
    setName(rememberedName(local()));
    const store = sessionStore();
    let next: string | null = null;
    try {
      next = store?.getItem("tripeco.returnTo") ?? null;
    } catch {
      next = null;
    }
    setSpliteco(signInViaSplitecoUrl(window.location.origin, window.location.host, next));
  }, []);

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
      rememberName(local(), r.user.displayName, r.user.email);
      setMe(r.user);
      signIn(r.token);
    } catch (err) {
      setError(errorText(err) === "Something went wrong" ? "That code didn't work" : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <main className="signin">
        <div className="signin-brand">
          <span className="mark">
            <Icon name="car" size={36} />
          </span>
          <h1>Tripeco</h1>
          <p>Split what the drive cost.</p>
        </div>

        {!other ? (
          <>
            {spliteco ? (
              <a className="continue" href={spliteco}>
                <span className="face" style={{ background: "#1C3357", color: "#93C5FD" }} aria-hidden="true">
                  {name ? initialOf(name) : "S"}
                </span>
                <span className="grow">
                  <span className="t">{name ? `Continue as ${name}` : "Continue with Spliteco"}</span>
                  <span className="s">Your Spliteco account</span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            ) : null}
            <button className="link-btn" onClick={() => setOther(true)}>
              Use another account
            </button>
          </>
        ) : !challenge ? (
          <form className="stack" onSubmit={start}>
            <label className="sr-only" htmlFor="email">Email</label>
            <input id="email" className="text-input" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn" disabled={busy || !email.includes("@")}>Email me a code</button>
            <button type="button" className="link-btn" onClick={() => setOther(false)}>Back</button>
          </form>
        ) : (
          <form className="stack" onSubmit={complete}>
            <p className="muted" style={{ margin: 0, textAlign: "center" }}>Code sent to {challenge.hint}</p>
            {challenge.debugCode ? <p className="muted" style={{ margin: 0, textAlign: "center" }}>Code: {challenge.debugCode}</p> : null}
            <label className="sr-only" htmlFor="code">Code</label>
            <input id="code" className="text-input mono" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button className="btn" disabled={busy || code.trim().length < 6}>Sign in</button>
          </form>
        )}
        {error ? <p className="error" role="alert" style={{ textAlign: "center" }}>{error}</p> : null}
      </main>
    </div>
  );
}
