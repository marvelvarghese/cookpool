"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { createClient, wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { loginPathFor, nextParamFrom } from "@/lib/safe-next";
import { takeLoginNext, takeOAuthProvider } from "@/lib/login-return";
import { rememberSignInMethod } from "@/lib/first-run";
import { afterOAuthPath } from "@/components/kitchen/sign-in";
import { Button } from "@/components/ui/button";
import { KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { useKitchenBodyTheme } from "@/components/kitchen/theme-scope";
import { SignInMark, SIGN_IN_PRIMARY } from "@/components/kitchen/sign-in-ui";

// Human-readable copy for the `error` codes the identity-worker callback may
// return in the URL fragment.
const ERROR_COPY: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  email_required:
    "Your provider account has no email. Add an email with the provider, or sign in with an email code.",
  email_unverified:
    "Your provider email isn't verified. Verify it with the provider, or sign in with an email code.",
  exchange_failed: "Could not complete the handshake with the provider. Please try again.",
  identity_failed: "Could not read your profile from the provider. Please try again.",
  missing_code: "The provider did not return an authorization code. Please try again.",
  provider_unavailable: "This sign-in method is temporarily unavailable.",
  oauth_failed: "Something went wrong during sign-in. Please try again.",
  server_error: "Something went wrong on our side. Please try again.",
};

/**
 * Where Google (or any provider) returns (Cookpool SI-5: in Cookpool's look).
 * identity-worker redirects to the `returnTo` the sign-in page gave it, with
 * `#token=…` or `#error=…` in the fragment. `next` comes back in that
 * returnTo's query (`?next=`), and — as before SI-5 — in this tab's storage;
 * the query wins, and either is re-checked by `postLoginDestination`, so a
 * tampered value can only fall back to Home.
 *
 * Before going on (SI-6) it reads the new session's profile: one with no name
 * goes to the sign-in page's Name step first (`/login?step=name&next=…`).
 * Google brings a name for a new account, but signing in with Google to an
 * account first made by code keeps that account's name, which may be none.
 * A read that fails goes straight on. It also records that this device signed
 * in with Google (You's "How you sign in").
 */
export default function OAuthCallbackPage() {
  useKitchenBodyTheme();
  const router = useRouter();
  const { setToken, target } = useSession();
  const [error, setError] = React.useState<string | null>(null);
  const [next, setNext] = React.useState<string | null>(null);
  // The fragment is read once: a second run (React's dev double effects)
  // would find it scrubbed and report a failure.
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || handled.current) return;
    handled.current = true;

    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(raw);
    const token = params.get("token");
    const err = params.get("error");
    const fromReturnTo = nextParamFrom(window.location.search);

    // Scrub the fragment (and the query) from the address bar / history so
    // the token does not linger in the URL.
    window.history.replaceState(null, "", window.location.pathname);

    // The login page stashed its `?next=` before leaving for the provider;
    // take it either way, so it is used once.
    const stashed = takeLoginNext();
    const destination = fromReturnTo ?? stashed;
    const provider = takeOAuthProvider();

    if (token) {
      setToken(token);
      rememberSignInMethod(provider === "google" ? "google" : null);
      // The session's client still has the old token on this render: ask with the new one.
      void wrap(() => createClient(target, token).auth.getProfile()).then((r) => {
        router.replace(afterOAuthPath(r.ok ? { ok: true, user: r.data.user } : { ok: false, status: r.status }, destination));
      });
      return;
    }

    setNext(destination);
    setError(err ?? "oauth_failed");
  }, [router, setToken, target]);

  return (
    <div className={cn(...KITCHEN_THEME_CLASSES, "grid min-h-dvh place-items-center bg-background px-5 text-foreground")}>
      {error ? (
        <div className="flex w-full max-w-md flex-col gap-4">
          <SignInMark />
          <h1 className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em]">Sign-in didn&apos;t finish</h1>
          <p role="alert" className="text-[15px] leading-normal text-muted-foreground">
            {ERROR_COPY[error] ?? ERROR_COPY.oauth_failed}
          </p>
          <Button className={cn(SIGN_IN_PRIMARY, "mt-2")} onClick={() => router.replace(loginPathFor(next))}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Signing you in…
        </p>
      )}
    </div>
  );
}
