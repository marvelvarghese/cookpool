"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CODE_LENGTH, CODE_LIFETIME_MINUTES, liveInitials, type SignInNotice } from "./sign-in";
import {
  CANT_SIGN_IN,
  CODE_HINT,
  NO_EMAIL_LINE,
  SIGN_IN_HELPER,
  SIGN_UP_HELPER,
  googleLabel,
  signUpNameHint,
  type CodeBox,
  type RememberedCard,
  type SignInTab,
} from "./sign-in-screens";
import { GoogleButton, NoticeBox, OrDivider, PersonAvatar, SIGN_IN_INPUT, SIGN_IN_PRIMARY, SIGN_IN_PRIMARY_IDLE } from "./sign-in-ui";
import { AuthTabs, BackBar, CodeBoxesField, MailTile, RememberedAccountView, SignInFooter } from "./sign-in-screens-ui";
import { PASSKEY_SIGN_IN_HELPER } from "./passkeys";
import { PasskeySignInButton } from "./passkey-ui";

/**
 * The sign-in page's two screens before you are in (Cookpool PK-3): the start
 * (Sign in · Create account, `AuthWelcome`/`AuthSignUp`/`WebAuth`) and the
 * code (`AuthCode`). Props only: `app/login/page.tsx` holds the state.
 */

export interface StartStepProps {
  mode: SignInTab;
  onMode: (mode: SignInTab) => void;
  /** The desktop form's title (the phone's is the welcome panel's). */
  title: string;
  remembered: RememberedCard | null;
  onContinue: () => void;
  onForget: () => void;
  continuing: boolean;
  /** Sign in with a passkey (PK-4): only where passkeys run; null hides it. */
  passkey?: { busy: boolean; onClick: () => void } | null;
  /** A passkey sign-in that did not work, shown under its button (not the email field's). */
  passkeyNotice?: string | null;
  withGoogle: boolean;
  googleBusy: boolean;
  onGoogle: () => void;
  email: string;
  onEmail: (value: string) => void;
  signUpName: string;
  onSignUpName: (value: string) => void;
  notice: SignInNotice | null;
  sending: boolean;
  /** Create account's button waits for a name and an address. */
  canSignUp: boolean;
  onSubmit: () => void;
  helpHref: string;
  emailRef: React.Ref<HTMLInputElement>;
  nameRef: React.Ref<HTMLInputElement>;
}

export function StartStep(p: StartStepProps) {
  const noticeId = p.notice ? "sign-in-notice" : undefined;
  const isNew = p.mode === "new";
  const showRemembered = !isNew && p.remembered !== null;
  // The passkey button is Sign in's, above Google (`AuthWelcome`, `WebAuth`).
  const withPasskey = !isNew && !!p.passkey;
  return (
    <section className="flex flex-1 flex-col gap-3.5 min-[900px]:gap-4">
      <AuthTabs mode={p.mode} onMode={p.onMode} />
      <h1
        id="sign-in-title-desktop"
        className="mt-1 hidden text-[30px] font-extrabold leading-[1.15] tracking-[-0.025em] min-[900px]:block"
      >
        {p.title}
      </h1>

      <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${p.mode}`} className="flex flex-col gap-3">
        {showRemembered && p.remembered ? (
          <>
            <RememberedAccountView card={p.remembered} onContinue={p.onContinue} onForget={p.onForget} busy={p.continuing} />
            {p.passkeyNotice ? <NoticeBox notice={{ tone: "error", text: p.passkeyNotice }} /> : null}
            {p.notice ? <NoticeBox id={noticeId} notice={p.notice} /> : null}
          </>
        ) : (
          <>
            {withPasskey && p.passkey ? <PasskeySignInButton onClick={p.passkey.onClick} busy={p.passkey.busy} /> : null}
            {withPasskey && p.passkeyNotice ? <NoticeBox notice={{ tone: "error", text: p.passkeyNotice }} /> : null}
            {p.withGoogle ? <GoogleButton onClick={p.onGoogle} busy={p.googleBusy} label={googleLabel(p.mode)} /> : null}
            {p.withGoogle || withPasskey ? <OrDivider label="or with email" /> : null}
            <form
              noValidate
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                p.onSubmit();
              }}
            >
              {isNew ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3.5">
                    <PersonAvatar initials={liveInitials(p.signUpName)} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <label htmlFor="sign-up-name" className="text-sm font-bold">
                        Your name
                      </label>
                      <input
                        ref={p.nameRef}
                        id="sign-up-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        autoCapitalize="words"
                        placeholder="What your groups call you"
                        value={p.signUpName}
                        onChange={(e) => p.onSignUpName(e.target.value)}
                        className={SIGN_IN_INPUT}
                      />
                    </div>
                  </div>
                  <span className="text-[13px] text-muted-foreground">{signUpNameHint(p.signUpName)}</span>
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sign-in-email" className="text-sm font-bold">
                  Email
                </label>
                <input
                  ref={p.emailRef}
                  id="sign-in-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={p.email}
                  onChange={(e) => p.onEmail(e.target.value)}
                  aria-invalid={p.notice?.tone === "error" || undefined}
                  aria-describedby={noticeId}
                  className={SIGN_IN_INPUT}
                />
              </div>
              {p.notice ? <NoticeBox id={noticeId} notice={p.notice} /> : null}
              <Button
                type="submit"
                disabled={isNew && !p.canSignUp && !p.sending}
                loading={p.sending}
                className={cn(SIGN_IN_PRIMARY, isNew && !p.canSignUp && !p.sending && SIGN_IN_PRIMARY_IDLE)}
              >
                Email me a code
              </Button>
              <span className="text-[13px] leading-[1.45] text-muted-foreground">{isNew ? SIGN_UP_HELPER : withPasskey ? PASSKEY_SIGN_IN_HELPER : SIGN_IN_HELPER}</span>
            </form>
          </>
        )}
      </div>

      <SignInFooter helpHref={p.helpHref} className="mt-auto pt-2" />
    </section>
  );
}

export interface CodeStepProps {
  stepLabel: string;
  email: string;
  onBack: () => void;
  boxes: CodeBox[];
  code: string;
  disabled: boolean;
  wrong: boolean;
  testCode: string | null;
  notice: SignInNotice | null;
  verifying: boolean;
  onCode: (raw: string) => void;
  onPaste: (pasted: string) => boolean;
  onFocusChange: (focused: boolean) => void;
  onSubmit: () => void;
  gmailUrl: string | null;
  resend: { label: string; disabled: boolean };
  onResend: () => void;
  helpHref: string;
  codeRef: React.Ref<HTMLInputElement>;
}

export function CodeStep(p: CodeStepProps) {
  const noticeId = p.notice ? "sign-in-notice" : undefined;
  return (
    <section aria-labelledby="code-title" className="flex flex-1 flex-col gap-4">
      <BackBar label={p.stepLabel} onBack={p.onBack} />
      <MailTile />
      <div className="flex flex-col gap-2">
        <h1 id="code-title" className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em] min-[900px]:text-[30px]">
          Check your email
        </h1>
        <p className="text-[15px] leading-normal text-[#3F4842]">
          We sent a {CODE_LENGTH}-digit code to{" "}
          <strong className="font-bold text-foreground [overflow-wrap:anywhere]">{p.email}</strong>. It works for{" "}
          {CODE_LIFETIME_MINUTES} minutes.
        </p>
      </div>

      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          p.onSubmit();
        }}
      >
        <CodeBoxesField
          boxes={p.boxes}
          inputRef={p.codeRef}
          inputProps={{
            value: p.code,
            disabled: p.disabled,
            onChange: (e) => p.onCode(e.target.value),
            onPaste: (e) => {
              if (p.onPaste(e.clipboardData.getData("text"))) e.preventDefault();
            },
            onFocus: () => p.onFocusChange(true),
            onBlur: () => p.onFocusChange(false),
            "aria-invalid": p.wrong || undefined,
            "aria-describedby": noticeId,
            "aria-busy": p.verifying || undefined,
          }}
        />
        {p.testCode ? (
          <p className="text-sm text-muted-foreground">
            Test code: <span className="font-bold tabular-nums text-foreground">{p.testCode}</span>
          </p>
        ) : null}
      </form>
      {p.notice ? <NoticeBox id={noticeId} notice={p.notice} /> : null}
      <p className="text-[13px] text-muted-foreground" aria-live="polite">
        {p.verifying ? "Signing you in…" : CODE_HINT}
      </p>

      <div className={cn("grid gap-2", p.gmailUrl ? "grid-cols-2" : "grid-cols-1")}>
        {p.gmailUrl ? (
          <a
            href={p.gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] items-center justify-center rounded-2xl border border-input bg-card text-[15px] font-extrabold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open Gmail
          </a>
        ) : null}
        <button
          type="button"
          disabled={p.resend.disabled}
          onClick={p.onResend}
          className="min-h-[52px] rounded-2xl border border-input bg-card text-[15px] font-extrabold tabular-nums text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-[#ECEEE9] disabled:text-muted-foreground"
        >
          {p.resend.label}
        </button>
      </div>

      <div className="mt-auto flex flex-col items-center gap-1 pt-2 text-center">
        <span className="text-sm text-[#3F4842]">{NO_EMAIL_LINE}</span>
        <Link
          href={p.helpHref}
          className="flex min-h-11 items-center rounded-lg text-[15px] font-bold text-primary hover:text-[#165C3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {CANT_SIGN_IN}
        </Link>
      </div>
    </section>
  );
}
