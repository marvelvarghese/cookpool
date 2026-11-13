"use client";

import * as React from "react";
import { Check, CircleAlert, CookingPot, Info } from "lucide-react";
import { PANEL_CHIPS, PANEL_FOOTER, PANEL_LINE } from "./sign-in-screens";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupAvatar, K_CARD } from "./kit";
import { CARD_EDGE } from "./rv-look";
import {
  NAME_EYEBROW,
  NAME_FOOTNOTE,
  NAME_LABEL,
  NAME_LATER,
  NAME_MAX,
  NAME_TITLE,
  liveInitials,
  nameExample,
  type JoinCard,
  type SignInNotice,
} from "./sign-in";

/**
 * The sign-in page's pieces (Cookpool SI-5), after the canvas artboards
 * `SignIn` (phone) and `WebSignIn` (desktop), in the kitchen's tokens. They
 * only make sense inside the `.cookpool` theme. The Name step (SI-6) is the
 * `SignIn` artboard's fourth step; You (`Account`) reuses its avatar.
 */

/** 54px rounded buttons and 52px fields: the sign-in page's touch sizes. */
export const SIGN_IN_PRIMARY =
  "h-14 w-full rounded-[18px] px-5 text-base font-medium focus-visible:ring-offset-background";
/** "Sign in" before a full, untried code: grey, not a faded green. */
export const SIGN_IN_PRIMARY_IDLE = "disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100";
export const SIGN_IN_INPUT =
  "h-[52px] w-full rounded-2xl border-[1.5px] border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/** The cookpool mark: the pot in a rounded square, and the wordmark. */
export function SignInMark({
  inverse = false,
  large = false,
  className,
}: {
  inverse?: boolean;
  large?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center",
          large ? "h-[38px] w-[38px] rounded-xl" : "h-9 w-9 rounded-xl",
          inverse ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
        )}
      >
        <CookingPot className={large ? "h-[21px] w-[21px]" : "h-5 w-5"} strokeWidth={2} />
      </span>
      <span className={cn("font-medium tracking-[-0.02em]", large ? "text-[21px]" : "text-lg")}>cookpool</span>
    </span>
  );
}

/** The panel's chips (`AuthWelcome`, `WebAuth`): white-on-green, the last one solid. */
export function PanelChips({ large = false }: { large?: boolean }) {
  return (
    <div aria-hidden className={cn("flex flex-wrap", large ? "gap-2.5" : "gap-2")}>
      {PANEL_CHIPS.map((chip, i) => (
        <span
          key={chip}
          className={cn(
            "rounded-full",
            large ? "px-3.5 py-[9px] text-[15px]" : "px-3 py-[7px] text-[13px]",
            i === PANEL_CHIPS.length - 1 ? "bg-primary-foreground font-medium text-primary" : "bg-primary-foreground/15 font-normal",
          )}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

/**
 * The green panel beside the form from 900px (`WebAuth`, PK-3): the mark,
 * the headline the tab chooses, the chips and one line about Cookpool.
 */
export function PitchPanel({ title, className }: { title: string; className?: string }) {
  return (
    <section
      aria-label="About Cookpool"
      className={cn(
        "flex-[1_1_480px] flex-col justify-between gap-10 bg-primary px-[clamp(24px,5vw,72px)] py-10 text-primary-foreground",
        className,
      )}
    >
      <SignInMark inverse large />
      <div className="flex max-w-[34rem] flex-col gap-6">
        <p className="text-[clamp(34px,4vw,54px)] font-medium leading-[1.05] tracking-[-0.03em]">{title}</p>
        <PanelChips large />
        <p className="text-[17px] leading-normal text-primary-foreground/85">{PANEL_LINE}</p>
      </div>
      <p className="text-[13px] text-primary-foreground/75">{PANEL_FOOTER}</p>
    </section>
  );
}

/** "Sign in to join Flat 4B · Anu invited you · 5 people are in". */
export function JoinCardView({ card }: { card: JoinCard }) {
  return (
    <div className={cn(K_CARD, "flex items-center gap-3 px-3.5 py-3")}>
      <GroupAvatar name={card.groupName} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-base font-medium leading-snug">{card.title}</p>
        {card.subtitle ? <p className="text-[13px] text-muted-foreground">{card.subtitle}</p> : null}
      </div>
    </div>
  );
}

export function JoinCardSkeleton() {
  return (
    <div aria-hidden className={cn(K_CARD, "flex items-center gap-3 px-3.5 py-3")}>
      <Skeleton className="h-11 w-11 shrink-0 rounded-[12px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
    </div>
  );
}

/** A message under a field: an alert (red) or a status line (amber). */
export function NoticeBox({
  notice,
  id,
  className,
}: {
  notice: SignInNotice;
  id?: string | undefined;
  className?: string;
}) {
  const error = notice.tone === "error";
  const success = notice.tone === "success";
  const Icon = error ? CircleAlert : success ? Check : Info;
  return (
    <div
      id={id}
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm font-normal leading-[1.45]",
        error ? "bg-cp-expired-tint text-cp-expired" : success ? "bg-cp-accent-tint text-cp-accent-text" : "bg-cp-soon-tint text-cp-soon",
        className,
      )}
    >
      <Icon className="mt-px h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
      <span>{notice.text}</span>
    </div>
  );
}

export function GoogleMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className={cn("shrink-0", className)}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/**
 * The secondary sign-in buttons (`RvSignIn`): Google and Passkey side by
 * side, on the card with its soft shadow and no ring in light; a 1 px line
 * in dark, where the card has none (RV-18, `CARD_EDGE`).
 */
export const SIGN_IN_SECONDARY = cn(
  "flex h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl border-0 bg-card px-4 text-[15px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70",
  CARD_EDGE,
);

export function GoogleButton({
  onClick,
  busy = false,
  label = "Continue with Google",
  short,
}: {
  onClick: () => void;
  busy?: boolean;
  /** Its full name: what it reads, or (with `short`) what a screen reader hears. */
  label?: string;
  /** The board's one word ("Google") beside Passkey; `label` stays its accessible name. */
  short?: string;
}) {
  return (
    <Button type="button" variant="outline" onClick={onClick} loading={busy} aria-label={short ? label : undefined} className={SIGN_IN_SECONDARY}>
      {busy ? null : <GoogleMark />}
      {short ?? label}
    </Button>
  );
}

/** The "or" rule: the border, and the `cp-line` grey in the new look's dark (RV-23). */
const OR_RULE = "h-px flex-1 bg-border cp-dark:bg-cp-line";

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[13px] font-normal text-muted-foreground">
      <span aria-hidden className={OR_RULE} />
      {label}
      <span aria-hidden className={OR_RULE} />
    </div>
  );
}

/**
 * "Developer sign-in" (local and dev only — the page decides): the baseline's
 * Bearer-token form and its API target picker, folded away behind a small
 * link. The token goes through the session's `setToken`, as it always has.
 */
export function DeveloperSignIn({
  targets,
  target,
  locked,
  onTarget,
  onToken,
}: {
  targets: readonly { name: string }[];
  target: string;
  locked: boolean;
  onTarget: (name: string) => void;
  onToken: (token: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [token, setToken] = React.useState("");
  const id = React.useId();
  return (
    <div className="flex flex-col items-start pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="min-h-11 rounded-lg text-[13px] font-medium text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Developer sign-in
      </button>
      {open ? (
        <div id={id} className="mt-1 w-full space-y-4 rounded-2xl border border-dashed border-input p-4">
          <p className="text-[13px] text-muted-foreground">Local and dev builds only. Not shown on stage or prod.</p>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = token.trim();
              if (value) onToken(value);
            }}
          >
            <label htmlFor={`${id}-token`} className="text-sm font-medium">
              Bearer token
            </label>
            <input
              id={`${id}-token`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a session token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={SIGN_IN_INPUT}
            />
            <p className="text-xs text-muted-foreground">Stored in this browser only, like any sign-in.</p>
            <Button type="submit" variant="outline" disabled={!token.trim()} className="h-11 w-full rounded-xl text-[15px] font-medium">
              Use this token
            </Button>
          </form>
          <div className="space-y-2">
            <p className="text-sm font-medium">API</p>
            {!locked && targets.length > 1 ? (
              <div role="group" aria-label="API target" className="flex flex-wrap gap-2">
                {targets.map((t) => (
                  <Button
                    key={t.name}
                    type="button"
                    size="sm"
                    aria-pressed={t.name === target}
                    variant={t.name === target ? "default" : "outline"}
                    onClick={() => onTarget(t.name)}
                    className="h-9 rounded-lg px-4 text-[13px] font-medium"
                  >
                    {t.name}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{target}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A person's initials in a green circle: the Name step (56px) and You (60px). */
export function PersonAvatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-medium text-primary-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * The Name step (SI-6, design §7): "What should your groups call you?", the
 * field prefilled from the email with the initials beside it, live, and
 * "Continue" — or "Join Flat 4B" from a join link. "Do this later" appears
 * only once a save has failed, so the step can never trap anyone.
 */
export function NameStep({
  name,
  onName,
  onSubmit,
  onLater,
  action,
  canSave,
  saving,
  saveFailed,
  notice,
  inputRef,
}: {
  name: string;
  onName: (value: string) => void;
  onSubmit: () => void;
  onLater: () => void;
  action: string;
  canSave: boolean;
  saving: boolean;
  saveFailed: boolean;
  notice: SignInNotice | null;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const noticeId = notice ? "name-notice" : undefined;
  return (
    <section aria-labelledby="name-title" className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2 pt-1.5 min-[900px]:p-0">
        <p className="text-[13px] font-medium text-cp-accent-text">{NAME_EYEBROW}</p>
        <h1 id="name-title" className="text-[28px] font-medium leading-[1.15] tracking-[-0.025em] min-[900px]:text-[30px]">
          {NAME_TITLE}
        </h1>
        <p className="text-[15px] leading-normal text-muted-foreground">{nameExample(name)}</p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSubmit();
        }}
      >
        <div className="flex items-center gap-3.5">
          <PersonAvatar initials={liveInitials(name)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="name-field" className="text-sm font-medium">
              {NAME_LABEL}
            </label>
            <input
              ref={inputRef}
              id="name-field"
              name="name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => onName(e.target.value)}
              aria-invalid={notice?.tone === "error" || undefined}
              aria-describedby={noticeId}
              className={SIGN_IN_INPUT}
            />
          </div>
        </div>
        {notice ? <NoticeBox id={noticeId} notice={notice} /> : null}
        <Button
          type="submit"
          disabled={!canSave}
          loading={saving}
          className={cn(SIGN_IN_PRIMARY, !canSave && !saving && SIGN_IN_PRIMARY_IDLE)}
        >
          {action}
        </Button>
      </form>
      {saveFailed ? (
        <button
          type="button"
          onClick={onLater}
          disabled={saving}
          className="min-h-11 self-start rounded-lg text-sm font-medium text-cp-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground"
        >
          {NAME_LATER}
        </button>
      ) : null}
      <p className="text-[13px] text-muted-foreground">{NAME_FOOTNOTE}</p>
    </section>
  );
}
