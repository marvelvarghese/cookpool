"use client";

import * as React from "react";
import { Check, Hourglass, Lock, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { saveUsualUnit, useUsualUnits } from "@/lib/pantry-device";
import type { MemberNames } from "./members";
import { RING } from "./new-home-parts-ui";
import { TickHeader, TickRow } from "./tick-row-ui";
import { usualUnitKey, type TickState } from "./tick-row";
import { sessionLineAskView, tickLine, tickable, type CookSession, type SessionLine } from "./cook-session";
import { cookLineFixed, cookLineMeta, cookTickAmount, cookTickItem, cookTickLabel, cookTickPercent, cookTickState, cookUnitChoice, setLineFromTick } from "./cook-tick";

/**
 * The cook session's ingredients as RV-10's tick rows (cookpool-revamp
 * RV-11, the canvas's RvCookLines): one card with the column header
 * (INGREDIENT · FROM | AMOUNT | ✓), a row per line — the name with where it
 * comes from under it, the recipe's amount for this session in grey with the
 * unit picker, and the tick for went in — then Add an ingredient. Every
 * change is the session's own (`save`): the tick is the line's ticked state,
 * a typed amount or a unit is its amount. Pure parts in cook-tick.ts.
 */

/** The thin bar under the header: how many of the lines are in. */
export function CookTickBar({ session }: { session: CookSession }) {
  return (
    <div aria-hidden className="h-1 overflow-hidden rounded-full bg-cp-line">
      <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${cookTickPercent(session)}%` }} />
    </div>
  );
}

const lineId = (key: string) => `session-line-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;

const END_BUTTON = cn("grid h-11 w-12 place-items-center rounded-xl transition-colors", RING);

export function CookTickList({
  session,
  meId,
  names,
  now,
  flagged = null,
  save,
  onTouch,
  onAsk,
  onCancelAsk,
  add,
}: {
  session: CookSession;
  meId: string;
  names?: MemberNames | null;
  now: Date;
  /** A refusal pointed at this line. */
  flagged?: string | null;
  save: (change: (s: CookSession) => CookSession) => void;
  /** Any change to a line (the screen clears what a refusal pointed at). */
  onTouch?: () => void;
  /** Ask before use (PN-9): the line's Ask, and Cancel while it waits. */
  onAsk?: (key: string, who: string) => void;
  onCancelAsk?: (key: string) => void;
  /** Add an ingredient, at the card's foot. */
  add?: React.ReactNode;
}) {
  const [boxes, setBoxes] = React.useState<ReadonlyMap<string, TickState>>(() => new Map());
  const units = useUsualUnits();
  return (
    <section aria-label="Ingredients" className="overflow-hidden rounded-[22px] bg-card shadow-cp-card">
      {session.lines.length > 0 ? <TickHeader item="INGREDIENT · FROM" /> : null}
      <ul>
        {session.lines.map((line, i) => (
          <li
            key={line.key}
            id={lineId(line.key)}
            className={cn("scroll-mt-24", i > 0 && "border-t border-cp-line", flagged === line.key && "outline outline-2 -outline-offset-2 outline-cp-expired")}
          >
            <CookTickLine
              line={line}
              meId={meId}
              names={names ?? null}
              now={now}
              held={boxes.get(line.key)}
              usual={units}
              onBox={(next) => setBoxes((m) => new Map(m).set(line.key, next))}
              save={(change) => {
                onTouch?.();
                save(change);
              }}
              onAsk={onAsk}
              onCancelAsk={onCancelAsk}
            />
          </li>
        ))}
      </ul>
      {add}
    </section>
  );
}

function CookTickLine({
  line,
  meId,
  names,
  now,
  held,
  usual,
  onBox,
  save,
  onAsk,
  onCancelAsk,
}: {
  line: SessionLine;
  meId: string;
  names: MemberNames | null;
  now: Date;
  held: TickState | undefined;
  usual: Readonly<Record<string, string>>;
  onBox: (next: TickState) => void;
  save: (change: (s: CookSession) => CookSession) => void;
  onAsk?: ((key: string, who: string) => void) | undefined;
  onCancelAsk?: ((key: string) => void) | undefined;
}) {
  const ask = sessionLineAskView(line, { meId, names, now });
  // An ask on its way, or approved, holds the amount it asked for. A missing line keeps its box and tick (RV-16).
  const locked = ask !== null && (ask.state === "waiting" || ask.state === "approved");
  const t = locked ? null : cookTickItem(line);
  const state = t ? cookTickState(line, t, held) : { typed: "", unit: null };
  const usualUnit = t?.real ? (usual[usualUnitKey(t.real)] ?? null) : null;
  const amount = t ? cookTickAmount(t, state, usualUnit) : null;
  const fixed = amount ? null : cookLineFixed(line);
  const ticked = line.ticked && ask === null;
  const done = ticked ? (amount ? { number: amount.number, word: amount.word } : { number: "", word: fixed ?? "" }) : null;
  const words = amount ? amount.words : (fixed ?? "");

  let end: React.ReactNode = null;
  if (ask) {
    if (ask.cancel && onCancelAsk) {
      end = (
        <button type="button" onClick={() => onCancelAsk(line.key)} aria-label={`Cancel the ask for ${line.name}`} className={cn(END_BUTTON, "bg-cp-soon-tint text-cp-soon")}>
          <X className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </button>
      );
    } else if (ask.button && onAsk) {
      end = (
        <button type="button" onClick={() => onAsk(line.key, ask.who)} aria-label={ask.buttonLabel ?? ask.button} className={cn(END_BUTTON, "bg-cp-cook-bg text-cp-cook-ink")}>
          <Lock className="h-5 w-5" strokeWidth={2.2} aria-hidden />
        </button>
      );
    } else {
      end = (
        <span
          aria-hidden
          className={cn(
            "grid h-11 w-12 place-items-center rounded-xl",
            ask.state === "approved" ? "bg-cp-accent-tint text-primary" : ask.state === "waiting" ? "bg-cp-soon-tint text-cp-soon" : "bg-muted text-muted-foreground",
          )}
        >
          {ask.state === "approved" ? <Check className="h-5 w-5" strokeWidth={2.6} /> : ask.state === "waiting" ? <Hourglass className="h-5 w-5" strokeWidth={2.2} /> : <X className="h-5 w-5" strokeWidth={2.4} />}
        </span>
      );
    }
  }

  return (
    <TickRow
      id={line.key}
      name={line.name}
      meta={cookLineMeta(line, meId, names)}
      amount={amount}
      fixed={fixed}
      state={state}
      onState={(picked) => {
        if (!t) return onBox(picked);
        // A unit chip (RV-10's row clears what was typed): keep the line's amount exactly.
        const next = picked.typed === "" && picked.unit !== state.unit && picked.unit ? cookUnitChoice(t, amount, picked.unit, usualUnit) : picked;
        onBox(next);
        const box = cookTickAmount(t, next, usualUnit);
        save((s) => setLineFromTick(s, line.key, t, box));
      }}
      onUnit={(id) => {
        if (t?.real) saveUsualUnit(usualUnitKey(t.real), id);
      }}
      done={done}
      onTick={() => {
        if (tickable(line)) save((s) => tickLine(s, line.key));
      }}
      end={end}
      tickLabel={(_w, name, isDone) => cookTickLabel(name, words, isDone)}
    >
      {ask?.text ? (
        <span role="status" className={cn("text-xs font-normal leading-snug", ask.state === "approved" ? "text-cp-accent-text" : ask.state === "waiting" ? "text-cp-soon" : "text-muted-foreground")}>
          {ask.text}
        </span>
      ) : null}
    </TickRow>
  );
}

/** Add an ingredient, at the card's foot: today's item picker (every kitchen, or something just bought). */
export const AddIngredientButton = React.forwardRef<HTMLButtonElement, { onClick: () => void; expanded: boolean; first: boolean }>(function AddIngredientButton(
  { onClick, expanded, first },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className={cn(
        "flex min-h-[52px] w-full items-center justify-center gap-1.5 text-[15px] font-medium text-cp-accent-text transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        !first && "border-t border-cp-line",
      )}
    >
      <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
      Add an ingredient
    </button>
  );
});

/** Under the card (the board's footnote). */
export function CookTickNote({ forWhom }: { forWhom: string | null }) {
  return (
    <p className="px-2 text-center text-[13px] font-normal text-muted-foreground">
      Tick what went in. Grey is the recipe&apos;s amount{forWhom ? ` for ${forWhom}` : ""}; type over it if you used more or less. Unticked rows aren&apos;t charged.
    </p>
  );
}
