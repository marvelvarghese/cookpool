"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { Pantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { RunLineEditor } from "./run-line-editor-ui";
import { pantryPick, pricePick, stepPick, toggleTick, type RunLine, type RunPicks, type TickedLine } from "./shopping-run";
import {
  answerChange,
  answerYes,
  checkQuestion,
  nonFoodText,
  receiptLineName,
  receiptPantryLabel,
  receiptPrice,
  receiptQuantity,
  renamePick,
  type ReceiptAnswers,
  type ReceiptCard,
  type ReceiptRun,
  type ReceiptState,
} from "./receipt-run";
import { AI_EDGE, AiChip, ReceiptCardView, TickButton } from "./receipt-scan-ui";

/**
 * The shopping run filled from a receipt (cookpool-ai AI-8, the canvas's
 * AiReceipt, result): the receipt's card, MATCHED (ticked), CHECK N (a
 * question each until answered) and the non-food lines left out behind Show.
 * Every row is a PN-6 run line: ticked, it opens the same − / +, price and
 * pantry; the run's footer and Add are `ShoppingRun`'s.
 */
export function ReceiptResult({
  run,
  card,
  photoUrl,
  state,
  onState,
  opened,
  pantries,
}: {
  run: ReceiptRun;
  card: ReceiptCard;
  photoUrl: string | null;
  state: ReceiptState;
  onState: (update: (s: ReceiptState) => ReceiptState) => void;
  opened: ReadonlyMap<string, TickedLine>;
  pantries: readonly Pantry[];
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [choosing, setChoosing] = React.useState<string | null>(null);
  const [showNonFood, setShowNonFood] = React.useState(false);
  const setPicks = (f: (p: RunPicks) => RunPicks) => onState((s) => ({ ...s, picks: f(s.picks) }));

  const row = (l: RunLine, answered?: ReceiptAnswers[string]) => (
    <ReceiptRow
      key={l.key}
      line={l}
      ticked={opened.get(l.key) ?? null}
      naming={answered === "change"}
      open={open === l.key}
      choosing={choosing === l.key}
      pantries={pantries}
      name={state.picks[l.key]?.name}
      onTick={() => {
        setPicks((p) => toggleTick(p, l));
        if (choosing === l.key) setChoosing(null);
      }}
      onOpen={() => {
        if (!state.picks[l.key]) setPicks((p) => toggleTick(p, l));
        setOpen((o) => (o === l.key ? null : l.key));
      }}
      onName={(text) => setPicks((p) => renamePick(p, l.key, text))}
      onStep={(delta) => setPicks((p) => stepPick(p, l, delta))}
      onPrice={(text) => setPicks((p) => pricePick(p, l.key, text))}
      onChoose={() => setChoosing((c) => (c === l.key ? null : l.key))}
      onPantry={(key) => {
        setPicks((p) => pantryPick(p, l.key, key, pantries));
        setChoosing(null);
      }}
    />
  );

  const nonFood = nonFoodText(run.nonFood);
  return (
    <>
      <ReceiptCardView card={card} photoUrl={photoUrl} />

      {run.matched.length > 0 ? (
        <section aria-labelledby="receipt-matched" className="flex flex-col gap-1.5">
          <h2 id="receipt-matched" className="px-0.5 text-xs font-extrabold tracking-[0.06em] text-[#165C3A]">
            MATCHED · {run.matched.length}
          </h2>
          <ul className={cn("divide-y divide-[#ECEEE9] overflow-hidden rounded-[20px] bg-card", AI_EDGE)}>{run.matched.map((l) => row(l))}</ul>
        </section>
      ) : null}

      {run.check.length > 0 ? (
        <section aria-labelledby="receipt-check" className="flex flex-col gap-1.5">
          <h2 id="receipt-check" className="px-0.5 text-xs font-extrabold tracking-[0.06em] text-[#8A5A00]">
            CHECK {run.check.length}
          </h2>
          <ul className="flex flex-col gap-2">
            {run.check.map((l) => {
              const answered = state.answers[l.key];
              if (answered) {
                return (
                  <li key={l.key} className="list-none">
                    <ul className={cn("overflow-hidden rounded-[18px] bg-card", AI_EDGE)}>{row(l, answered)}</ul>
                  </li>
                );
              }
              return (
                <CheckCard
                  key={l.key}
                  line={l}
                  onYes={() => onState((s) => answerYes(s, l))}
                  onChange={() => {
                    onState((s) => answerChange(s, l));
                    setOpen(l.key);
                  }}
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      {nonFood ? (
        <section aria-label="Left out" className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-x-1 text-[13px] font-bold text-muted-foreground">
            <span>{nonFood}</span>
            <button
              type="button"
              aria-expanded={showNonFood}
              onClick={() => setShowNonFood((v) => !v)}
              className="inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1.5 font-extrabold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showNonFood ? "Hide" : "Show"}
              <ChevronDown className={cn("h-4 w-4 transition-transform", showNonFood && "rotate-180")} aria-hidden />
            </button>
          </p>
          {showNonFood ? <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[20px] border border-[#E3E6E0] bg-card">{run.nonFood.map((l) => row(l))}</ul> : null}
        </section>
      ) : null}
    </>
  );
}

/** A CHECK question: the printed text, "Is this Paneer · 200 g · ₹95?", Yes, paneer and Change. */
function CheckCard({ line, onYes, onChange }: { line: RunLine; onYes: () => void; onChange: () => void }) {
  const q = checkQuestion(line);
  return (
    <li className="flex list-none flex-col gap-2 rounded-[18px] bg-[#FDF1D6] p-3">
      <span className="truncate font-mono text-xs text-[#8A5A00]">{line.receipt?.text}</span>
      <span className="text-[15px] font-extrabold text-[#5C3D00]">{q.question}</span>
      <span className={cn("grid gap-2", q.yes ? "grid-cols-[2fr_1fr]" : "grid-cols-1")}>
        {q.yes ? (
          <button
            type="button"
            onClick={onYes}
            className="min-h-11 truncate rounded-xl bg-[#5C3D00] px-3 text-sm font-extrabold text-white transition-colors hover:bg-[#4A3100] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {q.yes}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onChange}
          className="min-h-11 rounded-xl border border-[#E8C77A] bg-white px-3 text-sm font-extrabold text-[#5C3D00] transition-colors hover:bg-[#FFF8E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {q.change}
        </button>
      </span>
    </li>
  );
}

/**
 * One receipt line as a run line: the tick, the printed text in small
 * monospace above "Milk · 2 L", the pantry chip and the price. Tapping the
 * line opens PN-6's editor (ticking it); after Change, a name box too.
 */
function ReceiptRow({
  line,
  ticked,
  naming,
  open,
  choosing,
  pantries,
  name,
  onTick,
  onOpen,
  onName,
  onStep,
  onPrice,
  onChoose,
  onPantry,
}: {
  line: RunLine;
  ticked: TickedLine | null;
  naming: boolean;
  open: boolean;
  choosing: boolean;
  pantries: readonly Pantry[];
  name: string | undefined;
  onTick: () => void;
  onOpen: () => void;
  onName: (text: string) => void;
  onStep: (delta: 1 | -1) => void;
  onPrice: (text: string) => void;
  onChoose: () => void;
  onPantry: (key: string) => void;
}) {
  const on = ticked !== null;
  const shown = (on ? ticked.name : "") || receiptLineName(line);
  const qty = on ? ticked.step.words : receiptQuantity(line);
  const price = on ? (ticked.priceMinor !== null ? `${ticked.prefix}${ticked.priceText}` : "") : (receiptPrice(line) ?? "");
  const chip = on ? ticked.pantryLabel : receiptPantryLabel(line);
  const editing = on && (open || naming);
  return (
    <li className={cn("list-none", on && "bg-[#FBFCFA]")}>
      <div className="flex min-h-16 items-center gap-2.5 py-2 pl-2 pr-3">
        <TickButton on={on} label={`${on ? "Untick" : "Tick"} ${shown}`} onClick={onTick} />
        <button
          type="button"
          aria-expanded={editing}
          aria-label={`${shown} · ${qty}${price ? ` · ${price}` : ""} · ${chip} · change`}
          onClick={onOpen}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-mono text-[11px] text-[#7A837D]">{line.receipt?.text}</span>
            <span className="truncate text-[15px] font-extrabold">
              {shown} <span className="font-bold text-muted-foreground">· {qty}</span>
            </span>
          </span>
          <span className="max-w-[88px] shrink-0 truncate rounded-full bg-[#E6EEF8] px-2 py-0.5 text-[11px] font-extrabold text-[#1D4F91]">{chip}</span>
          <span className="min-w-12 shrink-0 text-right text-[15px] font-extrabold tabular-nums">{price}</span>
        </button>
      </div>
      {editing && naming ? (
        <div className="pb-2 pl-[62px] pr-3">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[#C9CFC6] px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-xs font-extrabold text-muted-foreground">Name</span>
            <input
              type="text"
              value={name ?? ""}
              onChange={(e) => onName(e.target.value)}
              aria-label={`Name for ${line.receipt?.text ?? "this line"}`}
              aria-invalid={(name ?? "").trim() === ""}
              placeholder="What is it?"
              autoComplete="off"
              maxLength={120}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-extrabold text-foreground outline-none placeholder:font-semibold"
            />
          </label>
        </div>
      ) : null}
      {editing ? (
        <RunLineEditor
          name={shown}
          ticked={ticked}
          choosing={choosing}
          pantries={pantries}
          onStep={onStep}
          onPrice={onPrice}
          onChoose={onChoose}
          onPantry={onPantry}
        />
      ) : null}
    </li>
  );
}

/** The result's heading: the chip and "Shopping run". */
export function ReceiptHeading() {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <AiChip />
      <h1 className="min-w-0 truncate text-xl font-extrabold tracking-[-0.01em]">Shopping run</h1>
    </span>
  );
}
