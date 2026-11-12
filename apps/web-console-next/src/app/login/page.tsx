"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthUser, OAuthProviderInfo } from "@saas/contracts/auth";
import type { JoinPreviewPublic } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { createClient, wrap } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { readStoredToken, useSession } from "@/lib/session";
import { nameStepFrom, postLoginDestination, signedOutFrom } from "@/lib/safe-next";
import { rememberJoinAfterSignIn, rememberLoginNext, rememberOAuthProvider } from "@/lib/login-return";
import { markNameAsked, rememberSignInMethod, type SignInMethod } from "@/lib/first-run";
import {
  forgetRememberedAccount,
  readRememberedAccount,
  rememberAccount,
  rememberAccountName,
  rememberTypedEmail,
  typedEmail,
} from "@/lib/remembered-account";
import { applyNewName } from "@/components/kitchen/data";
import { Skeleton } from "@/components/ui/skeleton";
import { KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { useKitchenBodyTheme } from "@/components/kitchen/theme-scope";
import {
  CODE_REPLACED_NOTICE,
  INITIAL_SIGN_IN,
  INVALID_EMAIL_NOTICE,
  SIGNED_OUT_NOTICE,
  canSaveName,
  canVerify,
  cleanDisplayName,
  completeOutcome,
  desktopTitle,
  isCodeComplete,
  joinCard,
  joinCodeFromNext,
  looksLikeEmail,
  nameCheck,
  nameStepAction,
  needsName,
  oauthReturnTo,
  offersGoogle,
  replacementRefusedNotice,
  sanitizeCode,
  saveNameOutcome,
  showsDeveloperSignIn,
  signInEnvironment,
  signInReducer,
  startRefusal,
  testCodeFor,
  type SignInEnvironment,
} from "@/components/kitchen/sign-in";
import {
  RESENT_NOTICE,
  canStartSignUp,
  codeBoxes,
  codeStepLabel,
  continueMethod,
  formTitle,
  gmailInboxUrl,
  heroTitle,
  helpPathFor,
  rememberedCard,
  resendButton,
  signUpNameToSave,
  type RememberedAccount,
} from "@/components/kitchen/sign-in-screens";
import {
  DeveloperSignIn,
  JoinCardSkeleton,
  JoinCardView,
  NameStep,
  NoticeBox,
  PitchPanel,
  SignInMark,
} from "@/components/kitchen/sign-in-ui";
import { WelcomeHero } from "@/components/kitchen/sign-in-screens-ui";
import { CodeStep, StartStep } from "@/components/kitchen/sign-in-steps-ui";
import { authenticate, markDeviceHasPasskey, markOfferDue, shouldOfferPasskey } from "@/lib/passkey-device";
import { passkeyHere, passkeySignInLabel, signInWithPasskey } from "@/components/kitchen/passkeys";
import { PasskeyOfferScreen, usePasskeysHere } from "@/components/kitchen/passkey-ui";

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
 * local and dev only; a code on screen appears only off prod (on stage for any
 * address identity-worker returns one for: every address, SI-9). The token is
 * stored exactly as before: `setToken`.
 *
 * The Name step (SI-6, design §7): after a code sign-in whose profile has no
 * name, the page asks "What should your groups call you?" before going on to
 * `next` — so from a join link it is sign-in → name → joined, the join page
 * reading SI-5's record as before. Google's callback and the kitchen's
 * once-only ask come back here as `?step=name`: the page reads the profile
 * and asks, or goes straight on when there is a name, when the read fails
 * (never a trap), or to the start when the token is no longer accepted.
 *
 * The getting-in screens (PK-3, cookpool-passkeys design §3), in every frame:
 * Sign in · Create account tabs under the green welcome panel; the account
 * remembered on this device ("Continue as Rahul", by its last method, and
 * "Use another account"); Create account takes the name up front and saves
 * it after the code only when the account has none; the code fills six boxes
 * from one input; and "Can't sign in?" opens `/login/help`.
 *
 * Passkeys (PK-4), where they run (WebAuthn, and the host is the RP ID):
 * "Sign in with a passkey" above Google, and a remembered passkey account's
 * "Sign in with Face ID". It finishes as a code sign-in does (the session,
 * the remembered account, the join, the Name step, `next`). After a code
 * (or, from the Name step, a Google) sign-in, "Turn on Face ID" may show
 * once, full screen, before landing (`land`).
 */

type JoinLookup =
  | { state: "none" }
  | { state: "loading" }
  | { state: "found"; preview: JoinPreviewPublic }
  | { state: "missing" };

/** What the page reads from its address. */
type LoginParams = Pick<URLSearchParams, "get" | "toString">;

const NO_PARAMS: LoginParams = new URLSearchParams();

/**
 * The page is a prerendered file (Cookpool SM-2), and its address's query is
 * only known in the browser: the file holds the page as it is with no query,
 * and the browser renders it with the real one (`useSearchParams` under a
 * Suspense boundary is how Next allows that in a static page).
 */
export default function LoginPage() {
  return (
    <React.Suspense fallback={<SignInPage params={NO_PARAMS} />}>
      <SignInWithQuery />
    </React.Suspense>
  );
}

function SignInWithQuery() {
  return <SignInPage params={useSearchParams()} />;
}

function SignInPage({ params }: { params: LoginParams }) {
  useKitchenBodyTheme();
  const router = useRouter();
  const rawNext = params.get("next");
  const signedOut = signedOutFrom(params.toString());
  const askedForName = nameStepFrom(params.toString());
  const joinCode = React.useMemo(() => joinCodeFromNext(rawNext), [rawNext]);
  const destination = postLoginDestination(rawNext);
  const { client, target, availableTargets, setTarget, setToken, isLocked, deployEnv } = useSession();
  const qc = useQueryClient();

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

  // The account remembered on this device (PK-3), read after mount (the page
  // is a prerendered file). Until it is read the start shows nothing below
  // the tabs, so a returning person never sees the empty form flash first.
  const [remembered, setRemembered] = React.useState<RememberedAccount | null>(null);
  const [rememberedRead, setRememberedRead] = React.useState(false);
  React.useEffect(() => {
    setRemembered(readRememberedAccount());
    setRememberedRead(true);
    // Back from Can't sign in?: the address this tab typed is still there.
    const typed = typedEmail();
    if (typed) dispatch({ type: "email", value: typed });
  }, []);
  const [codeFocused, setCodeFocused] = React.useState(false);

  // `?step=name` (SI-6): someone already signed in whose profile may have no
  // name. Read it once; until then the form waits. No token here means no
  // session: the page is the plain sign-in page.
  const [checkingName, setCheckingName] = React.useState(askedForName);
  // The session ended while on the page (a 401 on the Name step).
  const [sessionEnded, setSessionEnded] = React.useState(false);
  React.useEffect(() => {
    if (!askedForName) return;
    if (!readStoredToken()) {
      setCheckingName(false);
      return;
    }
    let cancelled = false;
    void wrap(() => clientRef.current.auth.getProfile()).then((r) => {
      if (cancelled) return;
      // What was read is the freshest copy: the page `next` opens paints from it.
      if (r.ok) qc.setQueryData(qk.profile(), r.data.user);
      const check = nameCheck(r.ok ? { ok: true, user: r.data.user } : { ok: false, status: r.status });
      if (check.kind === "go") {
        void land(r.ok ? r.data.user : null);
        return;
      }
      if (check.kind === "ask") {
        markNameAsked(check.userId);
        dispatch({ type: "ask_name", email: check.email });
      } else {
        setToken(null);
        setSessionEnded(true);
      }
      setCheckingName(false);
    });
    return () => {
      cancelled = true;
    };
    // Once per visit (router, setToken, qc and the destination are stable for it).
  }, [askedForName]);
  React.useEffect(() => {
    if (state.step !== "code") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.step]);

  const emailRef = React.useRef<HTMLInputElement>(null);
  const codeRef = React.useRef<HTMLInputElement>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const signUpNameRef = React.useRef<HTMLInputElement>(null);
  const lastStep = React.useRef(state.step);
  React.useEffect(() => {
    // Focus follows the step (not on first load: no keyboard until asked
    // for). The Name step takes focus only straight after the code step;
    // arriving at it (Google, the kitchen's ask) the page opens quietly.
    const from = lastStep.current;
    lastStep.current = state.step;
    if (from === state.step) return;
    if (state.step === "code") codeRef.current?.focus();
    else if (state.step === "start") (state.mode === "new" ? signUpNameRef : emailRef).current?.focus();
    else if (from === "code") nameRef.current?.focus();
  }, [state.step]);

  // Switching tabs puts the cursor in the tab's first field (not on first load).
  const lastMode = React.useRef(state.mode);
  React.useEffect(() => {
    if (lastMode.current === state.mode) return;
    lastMode.current = state.mode;
    if (state.step === "start") (state.mode === "new" ? signUpNameRef : emailRef).current?.focus();
  }, [state.mode, state.step]);

  const preview = join.state === "found" ? join.preview : null;
  const withGoogle = offersGoogle(providers);
  const [leaving, setLeaving] = React.useState(false);

  // Passkeys (PK-4): decided after mount; null until then hides every passkey control.
  const passkeys = usePasskeysHere();
  const passkeysRun = passkeys.runs === true;
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  const [passkeyNotice, setPasskeyNotice] = React.useState<string | null>(null);
  // Turn on Face ID, full screen, before landing: the first name it greets.
  const [offer, setOffer] = React.useState<{ firstName: string | null } | null>(null);

  /**
   * Go on to `next`, by way of Turn on Face ID when a code or Google sign-in
   * just happened and every condition holds (`shouldOfferPasskey`).
   */
  const land = async (user?: { displayName?: string | null } | null) => {
    if (await shouldOfferPasskey()) {
      setOffer({ firstName: cleanDisplayName(user?.displayName).split(" ")[0] || null });
      return;
    }
    router.replace(destination);
  };

  /** The join page may join at once only if this person saw the group's card. */
  const rememberJoin = () => {
    if (joinCode && join.state === "found") rememberJoinAfterSignIn(joinCode);
  };

  const signedIn = async (token: string, user: AuthUser, method: Extract<SignInMethod, "code" | "passkey"> = "code") => {
    setToken(token);
    rememberSignInMethod(method);
    rememberAccount(user, method);
    // A code sign-in may be offered Face ID before landing; a passkey one never is.
    if (method === "code") markOfferDue();
    rememberJoin();
    // Create account (PK-3): the name typed up front, saved now, only when
    // this account has none. If it cannot be saved, the Name step asks again.
    const toSave = signUpNameToSave(state, user);
    if (toSave) {
      // The session's client still has no token on this render: ask with the new one.
      const r = await wrap(() => createClient(target, token).auth.updateProfile({ displayName: toSave }));
      if (r.ok) {
        applyNewName(qc, r.data.user);
        rememberAccountName(user.email, toSave);
        void land(r.data.user);
        return;
      }
      markNameAsked(user.id);
      dispatch({ type: "ask_name", email: user.email, name: toSave });
      const outcome = saveNameOutcome(r.error, r.status);
      if (outcome.kind === "refused") dispatch({ type: "name_refused", notice: outcome.notice });
      return;
    }
    if (needsName(user)) {
      // New here (or never named): the Name step, then `next` (SI-6).
      markNameAsked(user.id);
      dispatch({ type: "ask_name", email: user.email });
      return;
    }
    void land(user);
  };

  const saveName = async () => {
    const displayName = cleanDisplayName(state.name);
    if (!canSaveName(state)) return;
    dispatch({ type: "busy", busy: "save" });
    const r = await wrap(() => client.auth.updateProfile({ displayName }));
    if (r.ok) {
      // Home, People and the group's members show it at once.
      applyNewName(qc, r.data.user);
      rememberAccountName(r.data.user.email, displayName);
      // "Join Flat 4B" is a yes to joining: the join page joins without asking again.
      rememberJoin();
      void land(r.data.user);
      return;
    }
    const outcome = saveNameOutcome(r.error, r.status);
    if (outcome.kind === "signed_out") {
      setToken(null);
      setSessionEnded(true);
      dispatch({ type: "back" });
      return;
    }
    dispatch({ type: "name_refused", notice: outcome.notice });
  };

  const sendCode = async (mode: "first" | "again" | "replace", to?: string) => {
    const email = (to ?? state.email).trim();
    if (mode === "first" && !looksLikeEmail(email)) {
      dispatch({
        type: "refused",
        refused: { notice: { tone: "error", text: INVALID_EMAIL_NOTICE }, retryAfterSeconds: null },
        at: Date.now(),
      });
      emailRef.current?.focus();
      return;
    }
    if (mode === "first") rememberTypedEmail(email);
    dispatch({ type: "busy", busy: "send" });
    const r = await wrap(() => client.auth.loginStart({ email }));
    const at = Date.now();
    setNow(at);
    if (r.ok) {
      dispatch({
        type: "sent",
        email,
        challengeId: r.data.challengeId,
        testCode: testCodeFor(env, r.data.delivery),
        at,
        resent: mode !== "first",
        notice:
          mode === "replace"
            ? { tone: "info", text: CODE_REPLACED_NOTICE }
            : mode === "again"
              ? { tone: "success", text: RESENT_NOTICE }
              : null,
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
      await signedIn(r.data.token, r.data.user);
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

  /** Sign in with a passkey (PK-4): options, the browser's sheet, verify; then as a code sign-in finishes. */
  const startPasskey = async () => {
    if (passkeyBusy || state.busy !== null || leaving) return;
    setPasskeyNotice(null);
    setPasskeyBusy(true);
    const out = await signInWithPasskey({
      loginOptions: () => wrap(() => clientRef.current.auth.passkeyLoginOptions()),
      authenticate,
      loginVerify: (response) => wrap(() => clientRef.current.auth.passkeyLoginVerify({ response })),
    });
    setPasskeyBusy(false);
    if (out.kind === "signed_in") {
      markDeviceHasPasskey();
      await signedIn(out.session.token, out.session.user, "passkey");
      return;
    }
    // A closed sheet leaves the screen as it was.
    if (out.kind === "failed") setPasskeyNotice(out.notice);
  };

  const startGoogle = () => {
    setPasskeyNotice(null);
    setLeaving(true);
    // The round trip leaves the app: `next` rides in the returnTo and, as
    // before, in this tab's storage; the callback re-checks whichever it reads.
    rememberLoginNext(rawNext);
    rememberOAuthProvider("google");
    rememberJoin();
    window.location.href = client.auth.oauthStartUrl("google", oauthReturnTo(window.location.origin, rawNext));
  };

  /** "Continue as Rahul": the way this device signed in last, Google or a code to the remembered address. */
  const continueAsRemembered = () => {
    if (!remembered || state.busy !== null || leaving || passkeyBusy) return;
    const how = continueMethod(remembered, withGoogle, passkeysRun);
    if (how === "passkey") {
      void startPasskey();
      return;
    }
    if (how === "google") {
      startGoogle();
      return;
    }
    setPasskeyNotice(null);
    dispatch({ type: "email", value: remembered.email });
    void sendCode("first", remembered.email);
  };

  /** "Use another account": forget it here, and start from the empty form. */
  const forgetRemembered = () => {
    forgetRememberedAccount();
    setRemembered(null);
    setPasskeyNotice(null);
    dispatch({ type: "email", value: "" });
    window.requestAnimationFrame(() => emailRef.current?.focus());
  };

  const submitStart = () => {
    if (state.busy !== null || passkeyBusy) return;
    setPasskeyNotice(null);
    if (state.mode === "new" && !canStartSignUp(state)) return;
    void sendCode("first");
  };

  const joinLoading = join.state === "loading";
  const wrong = state.rejectedCode !== null && state.code === state.rejectedCode;
  const ready = canVerify(state);
  const naming = state.step === "name";
  const starting = state.step === "start" && !naming && !checkingName;
  const helpHref = helpPathFor(rawNext);
  const panelTitle = heroTitle(state.mode, remembered !== null, null);

  if (offer) {
    return (
      <div className={cn(...KITCHEN_THEME_CLASSES, "min-h-dvh bg-background text-foreground")}>
        <PasskeyOfferScreen
          client={client}
          device={passkeys.device}
          firstName={offer.firstName}
          onFinish={() => router.replace(destination)}
        />
      </div>
    );
  }

  return (
    <div className={cn(...KITCHEN_THEME_CLASSES, "min-h-dvh bg-background text-foreground min-[900px]:flex")}>
      <PitchPanel title={panelTitle} className="hidden min-[900px]:flex" />

      <div className="flex min-h-dvh flex-col min-[900px]:flex-[1_1_420px]">
        {starting ? (
          <WelcomeHero title={heroTitle(state.mode, remembered !== null, preview)} className="min-[900px]:hidden" />
        ) : null}

        <main
          className={cn(
            "flex flex-1 justify-center px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]",
            starting ? "pt-[18px]" : "pt-[calc(env(safe-area-inset-top)+1rem)]",
            "min-[900px]:items-center min-[900px]:px-6 min-[900px]:py-10",
          )}
        >
          <div className="flex w-full max-w-md flex-col gap-4 min-[900px]:max-w-[26rem]">
            {!starting && state.step !== "code" ? <SignInMark className="min-[900px]:hidden" /> : null}

            {(signedOut || sessionEnded) && !naming && !checkingName ? (
              <NoticeBox notice={{ tone: "info", text: SIGNED_OUT_NOTICE }} />
            ) : null}

            {state.step === "code" ? null : joinLoading ? (
              <JoinCardSkeleton />
            ) : preview ? (
              <JoinCardView card={joinCard(preview, { joining: naming || checkingName || state.mode === "new" })} />
            ) : null}

            {checkingName ? (
              <div role="status" className="space-y-3 px-0.5 pt-1.5">
                <span className="sr-only">Checking your account…</span>
                <Skeleton aria-hidden className="h-4 w-40" />
                <Skeleton aria-hidden className="h-8 w-full" />
                <Skeleton aria-hidden className="h-8 w-2/3" />
                <Skeleton aria-hidden className="mt-4 h-[52px] w-full rounded-[14px]" />
              </div>
            ) : naming ? (
              <NameStep
                name={state.name}
                onName={(value) => dispatch({ type: "name", value })}
                onSubmit={() => void saveName()}
                onLater={() => void land(null)}
                action={nameStepAction(preview)}
                canSave={canSaveName(state)}
                saving={state.busy === "save"}
                saveFailed={state.nameSaveFailed}
                notice={state.notice}
                inputRef={nameRef}
              />
            ) : state.step === "start" ? (
              rememberedRead ? (
                <StartStep
                  mode={state.mode}
                  onMode={(mode) => dispatch({ type: "tab", mode })}
                  title={state.mode === "in" ? desktopTitle(preview) : formTitle("new")}
                  remembered={
                    remembered
                      ? rememberedCard(
                          remembered,
                          passkeysRun ? { label: passkeySignInLabel(passkeys.device), here: passkeyHere(passkeys.device) } : null,
                        )
                      : null
                  }
                  onContinue={continueAsRemembered}
                  onForget={forgetRemembered}
                  continuing={state.busy === "send" || leaving || passkeyBusy}
                  passkey={passkeysRun ? { busy: passkeyBusy, onClick: () => void startPasskey() } : null}
                  withGoogle={withGoogle}
                  googleBusy={leaving}
                  onGoogle={startGoogle}
                  email={state.email}
                  onEmail={(value) => dispatch({ type: "email", value })}
                  signUpName={state.signUpName}
                  onSignUpName={(value) => dispatch({ type: "sign_up_name", value })}
                  passkeyNotice={passkeyNotice}
                  notice={state.notice}
                  sending={state.busy === "send"}
                  canSignUp={canStartSignUp(state)}
                  onSubmit={submitStart}
                  helpHref={helpHref}
                  emailRef={emailRef}
                  nameRef={signUpNameRef}
                />
              ) : (
                <div aria-hidden className="h-[52px]" />
              )
            ) : (
              <CodeStep
                stepLabel={codeStepLabel(state.mode)}
                email={state.email}
                onBack={() => dispatch({ type: "back" })}
                boxes={codeBoxes(state.code, { wrong, focused: codeFocused })}
                code={state.code}
                disabled={state.challengeId === null}
                wrong={wrong}
                testCode={state.testCode}
                notice={state.notice}
                verifying={state.busy === "verify"}
                onCode={onCodeInput}
                onPaste={(pasted) => {
                  // "246 810" or "246-810" is longer than the field allows;
                  // keep its digits rather than a truncated paste.
                  if (sanitizeCode(pasted) === pasted) return false;
                  onCodeInput(pasted);
                  return true;
                }}
                onFocusChange={setCodeFocused}
                onSubmit={() => {
                  if (ready) void verify(state.code);
                }}
                gmailUrl={gmailInboxUrl(state.email)}
                resend={resendButton(state, now)}
                onResend={() => void sendCode("again")}
                helpHref={helpHref}
                codeRef={codeRef}
              />
            )}

            {showsDeveloperSignIn(env) && !naming && !checkingName ? (
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
                  // A pasted token says nothing about how its person signs in.
                  rememberSignInMethod(null);
                  router.replace(destination);
                }}
              />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
