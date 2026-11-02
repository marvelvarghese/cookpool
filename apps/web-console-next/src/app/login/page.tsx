"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { OAuthProviderInfo } from "@saas/contracts/auth";
import type { JoinPreviewPublic } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { postLoginDestination, signedOutFrom } from "@/lib/safe-next";
import { rememberJoinAfterSignIn, rememberLoginNext } from "@/lib/login-return";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { useKitchenBodyTheme } from "@/components/kitchen/theme-scope";
import {
  CODE_LENGTH,
  CODE_LIFETIME_MINUTES,
  CODE_REPLACED_NOTICE,
  DESKTOP_SUBTITLE,
  INITIAL_SIGN_IN,
  INVALID_EMAIL_NOTICE,
  SIGNED_OUT_NOTICE,
  START_SUBTITLE,
  TERMS_SENTENCE,
  canVerify,
  completeOutcome,
  desktopTitle,
  isCodeComplete,
  joinCard,
  joinCodeFromNext,
  looksLikeEmail,
  oauthReturnTo,
  offersGoogle,
  replacementRefusedNotice,
  resendControl,
  sanitizeCode,
  showsDeveloperSignIn,
  signInEnvironment,
  signInReducer,
  startHeadline,
  startRefusal,
  termsLine,
  testCodeFor,
  type SignInEnvironment,
} from "@/components/kitchen/sign-in";
import {
  DeveloperSignIn,
  GoogleButton,
  JoinCardSkeleton,
  JoinCardView,
  NoticeBox,
  OrDivider,
  PitchPanel,
  SIGN_IN_INPUT,
  SIGN_IN_PRIMARY,
  SIGN_IN_PRIMARY_IDLE,
  SignInMark,
} from "@/components/kitchen/sign-in-ui";

/**
 * Sign-in (Cookpool SI-5, design §5): one page for Cookpool and the admin
 * console, phone first (`SignIn`), with the green panel beside the form from
 * 900px (`WebSignIn`). Continue with Google when the API lists it, or a
 * 6-digit code by email — the same step whether you are new or coming back.
 *
 * `?next=` (a same-origin path, `safeNextPath`) is where sign-in returns; a
 * join link (`/join/{code}`) also shows its group from the signed-out preview
 * (SI-4) and comes back already joined. `?expired=1` says the session ended.
 * The Bearer-token form and the API picker sit behind "Developer sign-in" on
 * local and dev only; a code on screen appears only off prod (stage: only for
 * `@cookpool.test`). The token is stored exactly as before: `setToken`.
 */

type JoinLookup =
  | { state: "none" }
  | { state: "loading" }
  | { state: "found"; preview: JoinPreviewPublic }
  | { state: "missing" };

export default function LoginPage() {
  useKitchenBodyTheme();
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  const signedOut = signedOutFrom(params.toString());
  const joinCode = React.useMemo(() => joinCodeFromNext(rawNext), [rawNext]);
  const { client, target, availableTargets, setTarget, setToken, isLocked, deployEnv } = useSession();

  // The sign-in calls need no session; the effects below must not re-run
  // because signing in replaced the client, so they read it through a ref.
  const clientRef = React.useRef(client);
  clientRef.current = client;

  // Where this console runs needs the host, so it is decided after mount;
  // until then nothing developer-only can show ("prod" fails closed).
  const [env, setEnv] = React.useState<SignInEnvironment>("prod");
  React.useEffect(() => {
    setEnv(signInEnvironment(deployEnv, window.location.hostname));
  }, [deployEnv]);

  const [providers, setProviders] = React.useState<OAuthProviderInfo[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void wrap(() => clientRef.current.auth.listOAuthProviders()).then((r) => {
      if (!cancelled && r.ok) setProviders(r.data.providers);
    });
    return () => {
      cancelled = true;
    };
  }, [target.url]);

  const [join, setJoin] = React.useState<JoinLookup>(() => (joinCode ? { state: "loading" } : { state: "none" }));
  React.useEffect(() => {
    if (!joinCode) {
      setJoin({ state: "none" });
      return;
    }
    let cancelled = false;
    setJoin({ state: "loading" });
    void wrap(() => clientRef.current.memberships.previewJoinPublic(joinCode)).then((r) => {
      if (cancelled) return;
      // A 404 (unknown or rotated code) — or any failure — shows nothing special.
      setJoin(r.ok ? { state: "found", preview: r.data } : { state: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, [joinCode, target.url]);

  const [state, dispatch] = React.useReducer(signInReducer, INITIAL_SIGN_IN);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (state.step !== "code") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.step]);

  const emailRef = React.useRef<HTMLInputElement>(null);
  const codeRef = React.useRef<HTMLInputElement>(null);
  const moved = React.useRef(false);
  React.useEffect(() => {
    // Focus follows the step (not on first load: no keyboard until asked for).
    if (!moved.current) {
      moved.current = true;
      return;
    }
    (state.step === "code" ? codeRef : emailRef).current?.focus();
  }, [state.step]);

  const preview = join.state === "found" ? join.preview : null;
  const withGoogle = offersGoogle(providers);
  const [leaving, setLeaving] = React.useState(false);

  /** The join page may join at once only if this person saw the group's card. */
  const rememberJoin = () => {
    if (joinCode && join.state === "found") rememberJoinAfterSignIn(joinCode);
  };

  const signedIn = (token: string) => {
    setToken(token);
    rememberJoin();
    router.replace(postLoginDestination(rawNext));
  };

  const sendCode = async (mode: "first" | "again" | "replace") => {
    const email = state.email.trim();
    if (mode === "first" && !looksLikeEmail(email)) {
      dispatch({
        type: "refused",
        refused: { notice: { tone: "error", text: INVALID_EMAIL_NOTICE }, retryAfterSeconds: null },
        at: Date.now(),
      });
      emailRef.current?.focus();
      return;
    }
    dispatch({ type: "busy", busy: "send" });
    const r = await wrap(() => client.auth.loginStart({ email }));
    const at = Date.now();
    setNow(at);
    if (r.ok) {
      dispatch({
        type: "sent",
        email,
        challengeId: r.data.challengeId,
        testCode: testCodeFor(env, email, r.data.delivery),
        at,
        resent: mode !== "first",
        notice: mode === "replace" ? { tone: "info", text: CODE_REPLACED_NOTICE } : null,
      });
      return;
    }
    const refused = startRefusal(r.error, r.status);
    if (mode === "replace") {
      dispatch({ type: "refused", refused, at, challengeGone: true, notice: replacementRefusedNotice(refused) });
    } else {
      dispatch({ type: "refused", refused, at });
    }
  };

  const verify = async (code: string) => {
    const challengeId = state.challengeId;
    if (!challengeId || !isCodeComplete(code)) return;
    dispatch({ type: "busy", busy: "verify" });
    const r = await wrap(() => client.auth.loginComplete({ challengeId, code }));
    if (r.ok) {
      signedIn(r.data.token);
      return;
    }
    const outcome = completeOutcome(r.error, r.status);
    if (outcome.kind === "wrong") {
      dispatch({ type: "wrong", code, notice: outcome.notice });
      // Typing the next digit replaces the refused code.
      window.requestAnimationFrame(() => {
        codeRef.current?.focus();
        codeRef.current?.select();
      });
      return;
    }
    if (outcome.kind === "new_code") {
      // Spent, expired or used: a new code goes out at once (design §5). If
      // that is refused too (the address's 15-minute limit), the page says so.
      await sendCode("replace");
      return;
    }
    dispatch({ type: "refused", refused: outcome, at: Date.now() });
  };

  const onCodeInput = (raw: string) => {
    const code = sanitizeCode(raw);
    dispatch({ type: "code", value: code });
    // A full code signs in by itself, once per code typed.
    if (isCodeComplete(code) && code !== state.rejectedCode && state.busy === null && state.challengeId) {
      void verify(code);
    }
  };

  const startGoogle = () => {
    setLeaving(true);
    // The round trip leaves the app: `next` rides in the returnTo and, as
    // before, in this tab's storage; the callback re-checks whichever it reads.
    rememberLoginNext(rawNext);
    rememberJoin();
    window.location.href = client.auth.oauthStartUrl("google", oauthReturnTo(window.location.origin, rawNext));
  };

  const joinLoading = join.state === "loading";
  const resend = resendControl(state, now);
  const wrong = state.rejectedCode !== null && state.code === state.rejectedCode;
  const ready = canVerify(state);
  const noticeId = state.notice ? "sign-in-notice" : undefined;

  return (
    <div className={cn(...KITCHEN_THEME_CLASSES, "min-h-dvh bg-background text-foreground min-[900px]:flex")}>
      <PitchPanel className="hidden min-[900px]:flex" />

      <main
        className={cn(
          "flex justify-center px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]",
          "min-[900px]:flex-[1_1_420px] min-[900px]:items-center min-[900px]:px-6 min-[900px]:py-10",
        )}
      >
        <div className="flex w-full max-w-md flex-col gap-4 min-[900px]:max-w-[26rem] min-[900px]:gap-[18px]">
          <SignInMark className="min-[900px]:hidden" />

          {signedOut ? <NoticeBox notice={{ tone: "info", text: SIGNED_OUT_NOTICE }} /> : null}

          {joinLoading ? <JoinCardSkeleton /> : preview ? <JoinCardView card={joinCard(preview)} /> : null}

          {state.step === "start" ? (
            <section aria-labelledby="sign-in-title" className="flex flex-col gap-4 min-[900px]:gap-[18px]">
              {joinLoading ? (
                <div aria-hidden className="space-y-2 px-0.5 pt-1.5">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="mt-3 h-4 w-4/5" />
                </div>
              ) : (
                <div className="flex flex-col gap-2 px-0.5 pt-1.5 min-[900px]:p-0">
                  <h1
                    id="sign-in-title"
                    className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em] min-[900px]:text-[30px]"
                  >
                    <span className="min-[900px]:hidden">{startHeadline(preview)}</span>
                    <span className="hidden min-[900px]:inline">{desktopTitle(preview)}</span>
                  </h1>
                  <p className="text-[15px] leading-normal text-muted-foreground">
                    <span className="min-[900px]:hidden">{START_SUBTITLE}</span>
                    <span className="hidden min-[900px]:inline">{DESKTOP_SUBTITLE}</span>
                  </p>
                </div>
              )}

              {withGoogle ? (
                <>
                  <GoogleButton onClick={startGoogle} busy={leaving} />
                  <OrDivider />
                </>
              ) : null}

              <form
                noValidate
                className="flex flex-col gap-4 min-[900px]:gap-[18px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (state.busy === null) void sendCode("first");
                }}
              >
                <div className="flex flex-col gap-2">
                  <label htmlFor="sign-in-email" className="text-sm font-bold">
                    Email
                  </label>
                  <input
                    ref={emailRef}
                    id="sign-in-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={state.email}
                    onChange={(e) => dispatch({ type: "email", value: e.target.value })}
                    aria-invalid={state.notice?.tone === "error" || undefined}
                    aria-describedby={noticeId}
                    className={SIGN_IN_INPUT}
                  />
                </div>
                {state.notice ? <NoticeBox id={noticeId} notice={state.notice} /> : null}
                <Button type="submit" loading={state.busy === "send"} className={SIGN_IN_PRIMARY}>
                  Email me a code
                </Button>
              </form>

              <p className="text-[13px] leading-normal text-muted-foreground">
                <span className="min-[900px]:hidden">{termsLine(withGoogle)}</span>
                <span className="hidden min-[900px]:inline">{TERMS_SENTENCE}</span>
              </p>
            </section>
          ) : (
            <section aria-labelledby="code-title" className="flex flex-col gap-4 min-[900px]:gap-[18px]">
              <button
                type="button"
                onClick={() => dispatch({ type: "back" })}
                className="-ml-1.5 inline-flex min-h-11 items-center gap-1.5 self-start rounded-xl pl-1.5 pr-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                Use a different email
              </button>
              <div className="flex flex-col gap-2">
                <h1
                  id="code-title"
                  className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em] min-[900px]:text-[30px]"
                >
                  Check your email
                </h1>
                <p className="text-[15px] leading-normal text-muted-foreground">
                  We sent a {CODE_LENGTH}-digit code to{" "}
                  <strong className="font-bold text-foreground [overflow-wrap:anywhere]">{state.email}</strong>. It works for{" "}
                  {CODE_LIFETIME_MINUTES} minutes.
                </p>
              </div>

              <form
                noValidate
                className="flex flex-col gap-4 min-[900px]:gap-[18px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (ready) void verify(state.code);
                }}
              >
                <div className="flex flex-col gap-2">
                  <label htmlFor="sign-in-code" className="text-sm font-bold">
                    {CODE_LENGTH}-digit code
                  </label>
                  <input
                    ref={codeRef}
                    id="sign-in-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={CODE_LENGTH}
                    placeholder="••••••"
                    value={state.code}
                    disabled={state.challengeId === null}
                    onChange={(e) => onCodeInput(e.target.value)}
                    onPaste={(e) => {
                      // "246 810" or "246-810" is longer than the field allows;
                      // keep its digits rather than a truncated paste.
                      const pasted = e.clipboardData.getData("text");
                      if (sanitizeCode(pasted) !== pasted) {
                        e.preventDefault();
                        onCodeInput(pasted);
                      }
                    }}
                    aria-invalid={wrong || undefined}
                    aria-describedby={noticeId}
                    className={cn(
                      "h-16 w-full rounded-2xl bg-card px-3.5 text-center indent-[0.45em] text-[30px] font-bold tracking-[0.45em] tabular-nums text-foreground",
                      "placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      wrong ? "border-2 border-destructive" : "border border-input",
                    )}
                  />
                  {state.testCode ? (
                    <p className="text-sm text-muted-foreground">
                      Test code: <span className="font-bold tabular-nums text-foreground">{state.testCode}</span>
                    </p>
                  ) : null}
                </div>
                {state.notice ? <NoticeBox id={noticeId} notice={state.notice} /> : null}
                <Button
                  type="submit"
                  disabled={!ready}
                  loading={state.busy === "verify"}
                  className={cn(SIGN_IN_PRIMARY, !ready && state.busy !== "verify" && SIGN_IN_PRIMARY_IDLE)}
                >
                  Sign in
                </Button>
              </form>

              <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
                <span>No email? Check your spam folder.</span>
                <button
                  type="button"
                  disabled={resend.disabled}
                  onClick={() => void sendCode("again")}
                  className="min-h-11 rounded-lg text-sm font-bold text-primary tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                >
                  {resend.label}
                </button>
              </div>
            </section>
          )}

          {showsDeveloperSignIn(env) ? (
            <DeveloperSignIn
              targets={availableTargets}
              target={target.name}
              locked={isLocked}
              onTarget={(name) => {
                const next = availableTargets.find((t) => t.name === name);
                if (next) setTarget(next);
              }}
              onToken={(token) => {
                setToken(token);
                router.replace(postLoginDestination(rawNext));
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
