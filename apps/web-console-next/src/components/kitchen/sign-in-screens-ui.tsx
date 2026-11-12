"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Mail } from "lucide-react";
import { cn } from "@/lib/cn";
import { CODE_LENGTH, TERMS_SENTENCE } from "./sign-in";
import {
  CANT_SIGN_IN,
  SIGN_IN_TABS,
  USE_ANOTHER_ACCOUNT,
  type CodeBox,
  type RememberedCard,
  type SignInTab,
} from "./sign-in-screens";
import { PanelChips, PersonAvatar, SignInMark } from "./sign-in-ui";

/**
 * The getting-in screens' pieces (Cookpool PK-3), after the canvas row
 * "Getting in": the phone's green welcome panel (`AuthWelcome`), the Sign in ·
 * Create account tabs, the remembered account, the code's six boxes
 * (`AuthCode`) and the back bar. Inside the `.cookpool` theme only.
 */

/** The phone's welcome panel: green, rounded at the bottom, the headline and the chips. */
export function WelcomeHero({ title, className }: { title: string; className?: string }) {
  return (
    <section
      aria-label="Cookpool"
      className={cn(
        "flex flex-col gap-[18px] rounded-b-[32px] bg-primary px-[22px] pb-[26px] pt-[calc(env(safe-area-inset-top)+22px)] text-primary-foreground",
        className,
      )}
    >
      <SignInMark inverse />
      <h1 id="sign-in-title" className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em]">
        {title}
      </h1>
      <PanelChips />
    </section>
  );
}

/** Sign in · Create account. */
export function AuthTabs({ mode, onMode }: { mode: SignInTab; onMode: (mode: SignInTab) => void }) {
  return (
    <div role="tablist" aria-label="Sign in or create account" className="grid grid-cols-2 gap-1 rounded-[14px] bg-[#ECEEE9] p-1">
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
              "min-h-11 rounded-[11px] text-[15px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card text-foreground shadow-[0_1px_3px_rgba(23,32,27,0.12)]" : "text-[#3F4842] hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The account remembered on this device, its one main button, and "Use another account". */
export function RememberedAccountView({
  card,
  onContinue,
  onForget,
  busy,
}: {
  card: RememberedCard;
  onContinue: () => void;
  onForget: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-[18px] border bg-card px-3.5 py-3">
        <PersonAvatar initials={card.initials} className="h-[46px] w-[46px] text-[17px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-extrabold">{card.title}</span>
          <span className="truncate text-[13px] text-muted-foreground">{card.subtitle}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={onContinue}
        disabled={busy}
        aria-busy={busy || undefined}
        className="flex min-h-[58px] items-center justify-center gap-2.5 rounded-2xl bg-[#17201B] px-5 text-base font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70"
      >
        {busy ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
        {card.action}
      </button>
      <button
        type="button"
        onClick={onForget}
        className="min-h-11 rounded-lg text-sm font-bold text-[#3F4842] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {USE_ANOTHER_ACCOUNT}
      </button>
    </div>
  );
}

/** "Can't sign in?" and the terms line, at the foot of the form. */
export function SignInFooter({ helpHref, className }: { helpHref: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 text-center", className)}>
      <Link
        href={helpHref}
        className="flex min-h-11 items-center rounded-lg text-[15px] font-bold text-primary hover:text-[#165C3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {CANT_SIGN_IN}
      </Link>
      <span className="text-xs leading-[1.45] text-muted-foreground">{TERMS_SENTENCE}</span>
    </div>
  );
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
      {label ? <span className="text-[13px] font-bold text-muted-foreground">{label}</span> : null}
      <span aria-hidden className="w-11" />
    </div>
  );
}

/** The envelope tile on the code screen. */
export function MailTile() {
  return (
    <span aria-hidden className="grid h-16 w-16 place-items-center rounded-[20px] bg-[#E4F2EA] text-primary">
      <Mail className="h-[30px] w-[30px]" strokeWidth={1.8} />
    </span>
  );
}

const BOX_BORDER: Record<CodeBox["state"], string> = {
  empty: "border border-input",
  filled: "border border-[#8E9A93]",
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
              "grid h-[60px] place-items-center rounded-[14px] bg-card text-[26px] font-extrabold tabular-nums text-foreground",
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
