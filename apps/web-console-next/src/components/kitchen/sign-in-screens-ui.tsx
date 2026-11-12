"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Fingerprint, KeyRound, Mail, ScanFace } from "lucide-react";
import { cn } from "@/lib/cn";
import { newFrame } from "@/lib/features";
import { CODE_LENGTH, TERMS_LEAD, termsHref } from "./sign-in";
import { SEG_OFF, SEG_ON, SEG_TRACK } from "./rv-look";
import {
  CANT_SIGN_IN,
  SIGN_IN_TABS,
  USE_ANOTHER_ACCOUNT,
  type CodeBox,
  type RememberedCard,
  type SignInTab,
} from "./sign-in-screens";
import { K_CARD } from "./kit";
import { PersonAvatar, SignInMark } from "./sign-in-ui";

/**
 * The getting-in screens' pieces (Cookpool PK-3), after the canvas row
 * "Getting in": the phone's green welcome panel (`AuthWelcome`), the Sign in ·
 * Create account tabs, the remembered account, the code's six boxes
 * (`AuthCode`) and the back bar. Inside the `.cookpool` theme only.
 */

/**
 * The phone's welcome panel (`RvSignIn`): the accent, rounded at the bottom,
 * the mark and the headline. Gold with dark text in dark mode.
 */
export function WelcomeHero({ title, className }: { title: string; className?: string }) {
  return (
    <section
      aria-label="Cookpool"
      className={cn(
        "flex flex-col gap-[22px] rounded-b-[32px] bg-primary px-[22px] pb-[30px] pt-[calc(env(safe-area-inset-top)+24px)] text-primary-foreground",
        className,
      )}
    >
      <SignInMark inverse />
      <h1 id="sign-in-title" className="text-[30px] font-medium leading-[1.1] tracking-[-0.03em]">
        {title}
      </h1>
    </section>
  );
}

/** Sign in · Create account: two tabs in a track, the chosen one on the card, with no ring (RV-18). */
export function AuthTabs({ mode, onMode }: { mode: SignInTab; onMode: (mode: SignInTab) => void }) {
  return (
    <div role="tablist" aria-label="Sign in or create account" className={cn("grid grid-cols-2 gap-1", SEG_TRACK)}>
      {SIGN_IN_TABS.map((t) => {
        const on = t.mode === mode;
        return (
          <button
            key={t.mode}
            type="button"
            role="tab"
            id={`auth-tab-${t.mode}`}
            aria-selected={on}
            aria-controls="auth-panel"
            onClick={() => onMode(t.mode)}
            className={cn(
              "min-h-11 rounded-xl text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? SEG_ON : SEG_OFF,
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The icon on the remembered card's button: the face or the finger the passkey asks for. */
function passkeyIcon(action: string) {
  if (/face id/i.test(action)) return ScanFace;
  if (/fingerprint/i.test(action)) return Fingerprint;
  return KeyRound;
}

/**
 * The account remembered on this device: its card, the one main button
 * ("Sign in with Face ID" for a passkey account, else "Continue as Rahul"),
 * and "Use another account".
 */
export function RememberedAccountView({
  card,
  onContinue,
  onForget,
  busy,
  passkey = false,
}: {
  card: RememberedCard;
  onContinue: () => void;
  onForget: () => void;
  busy: boolean;
  /** The button signs in with this device's passkey (its icon). */
  passkey?: boolean;
}) {
  const Icon = passkey ? passkeyIcon(card.action) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className={cn(K_CARD, "flex min-h-[68px] items-center gap-3 px-3.5 py-2.5")}>
        <PersonAvatar initials={card.initials} className="h-11 w-11 bg-cp-accent-tint text-[15px] text-cp-accent-text" />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-base font-medium">{card.title}</span>
          <span className="truncate text-[13px] font-normal text-muted-foreground">{card.subtitle}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={onContinue}
        disabled={busy}
        aria-busy={busy || undefined}
        className="flex min-h-14 items-center justify-center gap-2.5 rounded-[18px] bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-70"
      >
        {busy ? (
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : Icon ? (
          <Icon className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
        ) : null}
        {card.action}
      </button>
      <button
        type="button"
        onClick={onForget}
        className="min-h-11 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {USE_ANOTHER_ACCOUNT}
      </button>
    </div>
  );
}

/**
 * "Can't sign in?" and the one helper line, the terms, at the foot of the
 * form. Terms and the Privacy notice are links (RV-18): there is no page of
 * their own yet, so both open Can't sign in?'s Privacy and terms section,
 * keeping the sign-in's `next` (`helpHref` carries it).
 */
export function SignInFooter({ helpHref, className }: { helpHref: string; className?: string }) {
  const terms = termsHref(helpHref);
  const link = "rounded font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className={cn("flex flex-col items-center gap-1 text-center", className)}>
      <Link
        href={helpHref}
        className="flex min-h-11 items-center rounded-lg text-[15px] font-medium text-cp-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {CANT_SIGN_IN}
      </Link>
      <span className="text-xs font-normal leading-[1.45] text-muted-foreground">
        {TERMS_LEAD}
        <Link href={terms} className={link}>
          Terms
        </Link>
        {" and the "}
        <Link href={terms} className={link}>
          Privacy notice
        </Link>
        .
      </span>
    </div>
  );
}

/**
 * Whether the sign-in pages wear the new look's dark mode (RV-6): where
 * `newFrame()` is true (stage first), read after mount so the prerendered
 * file and the first render match. Sign-in has no raw colours left, so it
 * reads in both themes; prod stays light until the new frame ships there.
 */
export function useSignInNewLook(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => setOn(newFrame()), []);
  return on;
}

/** The bar above the code (and Can't sign in?): Back, and a label in the middle. */
export function BackBar({ label, onBack, href }: { label?: string; onBack?: () => void; href?: string }) {
  const cls =
    "grid h-11 w-11 place-items-center rounded-[14px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const icon = <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden />;
  return (
    <div className="flex items-center justify-between">
      {href ? (
        <Link href={href} aria-label="Back" className={cls}>
          {icon}
        </Link>
      ) : (
        <button type="button" aria-label="Back" onClick={onBack} className={cls}>
          {icon}
        </button>
      )}
      {label ? <span className="text-[13px] font-medium text-muted-foreground">{label}</span> : null}
      <span aria-hidden className="w-11" />
    </div>
  );
}

/** The envelope tile on the code screen. */
export function MailTile() {
  return (
    <span aria-hidden className="grid h-16 w-16 place-items-center rounded-[20px] bg-cp-accent-tint text-primary">
      <Mail className="h-[30px] w-[30px]" strokeWidth={1.8} />
    </span>
  );
}

const BOX_BORDER: Record<CodeBox["state"], string> = {
  empty: "border-[1.5px] border-input",
  filled: "border-[1.5px] border-muted-foreground",
  active: "border-2 border-primary",
  wrong: "border-2 border-destructive",
};

/**
 * Six boxes drawn from one real input laid over them, transparent: the
 * keyboard, autofill (`one-time-code`) and paste all reach that one field.
 */
export function CodeBoxesField({
  boxes,
  inputRef,
  inputProps,
}: {
  boxes: CodeBox[];
  inputRef: React.Ref<HTMLInputElement>;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="relative">
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {boxes.map((b, i) => (
          <span
            key={i}
            className={cn(
              "grid h-[60px] place-items-center rounded-2xl bg-card text-[26px] font-medium tabular-nums text-foreground",
              BOX_BORDER[b.state],
            )}
          >
            {b.digit}
          </span>
        ))}
      </div>
      <label htmlFor="sign-in-code" className="sr-only">
        {CODE_LENGTH}-digit code
      </label>
      <input
        id="sign-in-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        {...inputProps}
        ref={inputRef}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
