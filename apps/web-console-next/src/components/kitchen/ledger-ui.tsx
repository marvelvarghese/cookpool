"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatMinor } from "./money";
import { memberInitials, type MemberNames } from "./members";
import type { KindTone } from "./activity";

/**
 * The ledger's small visual pieces (Cookpool CP-8): amounts in tabular
 * numerals, the blue "gets back" / orange "owes" balance words, a person's
 * avatar, a transaction kind's glyph and the segmented control. Colors come
 * from the `.cookpool` tokens. Color is never the only cue: every amount says
 * which way it goes in words or with its sign.
 */

/** An amount, formatted by the engine's `formatMinor`, in tabular numerals. */
export function Money({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatMinor(minor, currency)}</span>;
}

/** A balance in words: "gets back ₹40.75" (blue), "owes ₹24.00" (orange), "settled up". */
export function BalanceWords({
  minor,
  currency,
  you = false,
  className,
}: {
  minor: number;
  currency: string;
  /** Second person ("you get back", "you owe"). */
  you?: boolean;
  className?: string;
}) {
  if (minor === 0) {
    return <span className={cn("text-sm text-muted-foreground", className)}>{you ? "You're settled up" : "settled up"}</span>;
  }
  const getsBack = minor > 0;
  return (
    <span className={cn("text-sm", getsBack ? "text-cp-owed" : "text-cp-owe", className)}>
      {getsBack ? (you ? "you get back" : "gets back") : you ? "you owe" : "owes"}{" "}
      <Money minor={Math.abs(minor)} currency={currency} className="font-bold" />
    </span>
  );
}

/** A person's round avatar: "You" in green, others' initials (or id tag) in grey. */
export function PersonAvatar({
  subjectId,
  meId,
  names,
  className,
}: {
  subjectId: string;
  meId: string | null;
  /** Display names (CP-9): a named person shows their initials. */
  names?: MemberNames | null;
  className?: string;
}) {
  const you = !!meId && subjectId === meId;
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold",
        you ? "bg-cp-herb-tint text-primary" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {memberInitials(subjectId, meId, names)}
    </span>
  );
}

const KIND_TONES: Record<KindTone, string> = {
  green: "bg-cp-herb-tint text-primary",
  tomato: "bg-cp-tomato-tint text-cp-tomato",
  blue: "bg-cp-owed-tint text-cp-owed",
  neutral: "bg-muted text-muted-foreground",
};

/** A transaction kind's glyph (₹ ✓ U D W ↺) in a tinted circle; its name is read out instead. */
export function KindBubble({ glyph, label, tone, className }: { glyph: string; label: string; tone: KindTone; className?: string }) {
  return (
    <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-extrabold", KIND_TONES[tone], className)}>
      <span aria-hidden>{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A row of mutually exclusive choices (radio semantics, arrow keys move), 44px tall. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; name?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid auto-cols-fr grid-flow-col rounded-xl border border-input bg-card p-0.5", className)}>
      {options.map((o, i) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.name}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "min-h-11 rounded-[10px] px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A pill-shaped choice chip (a person, a payment method), 44px tall. */
export function Chip({
  selected,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary bg-accent text-primary" : "border-input bg-card text-foreground hover:bg-accent/60",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
