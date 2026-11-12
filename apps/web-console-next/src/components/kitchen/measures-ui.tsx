"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { findMeasure, type KitchenItem, type KitchenMeasure } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { MAIN_BUTTON } from "./faces-ui";
import {
  MAX_MEASURES,
  SIZE_CHOICES,
  changedMeasures,
  choiceLabel,
  choiceOf,
  choicesForWord,
  choicesWith,
  firstAsk,
  freeKinds,
  measureInput,
  measureRow,
  measuresOf,
  packWord,
  saveLabel,
  savedForText,
  sizeQuestion,
  wordProblem,
  wordsFor,
  wordsForName,
} from "./measures";
import { useSetMeasures } from "./measures-data";

/**
 * Your measures on screen (Cookpool SM-14): the one-question sheet ("1 onion
 * weighs about" · 50 g 100 g 150 g 200 g · Save), opened the first time from
 * Use's "Count in onions" tile and, on the item page, to add, change or
 * remove one; the item page's "Counted as" block; and the [onions | g]
 * switch beside a stepper (Use's Another amount, Cook's ingredients).
 */

// ── The switch ────────────────────────────────────────────────────

export interface SwitchOption {
  key: string;
  label: string;
  on: boolean;
}

/** [onions | g]: which a stepper counts in. */
export function UnitSwitch({ options, onPick, label = "Count in", className }: { options: readonly SwitchOption[]; onPick: (key: string) => void; label?: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("flex shrink-0 rounded-xl bg-cp-line p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.on}
          onClick={() => onPick(o.key)}
          className={cn(
            "min-h-[38px] min-w-[52px] rounded-[9px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o.on ? "bg-card text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── The sheet ─────────────────────────────────────────────────────

/** What the sheet is for: the first measure (asked once, from Use), another one, or changing one (by its place). */
export type MeasureSheetMode = { kind: "first" } | { kind: "add" } | { kind: "change"; index: number };

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[24px] border-x-0 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3 shadow-2xl focus:outline-none",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
);

const CHIP = "min-h-[52px] rounded-[14px] text-base font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PILL = "min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TYPE = "Type one";

interface Start {
  one: string;
  many: string;
  /** The word is shown, to change. */
  typing: boolean;
  /** Pills to pick the word from (a pack's words; kinds when adding). */
  picks: readonly { one: string; many: string; label: string }[];
  choice: number | null;
}

function startOf(item: KitchenItem, mode: MeasureSheetMode): Start {
  const measures = measuresOf(item);
  if (mode.kind === "change") {
    const m = measures[mode.index]!;
    return { one: m.one, many: m.many, typing: false, picks: [], choice: choiceOf(item.dimension, m) };
  }
  if (mode.kind === "first") {
    const ask = firstAsk(item);
    return {
      one: ask.one,
      many: ask.many,
      typing: ask.editable,
      picks: ask.picker ? ask.picker.map((many) => ({ ...packWord(many), label: many })) : [],
      choice: null,
    };
  }
  // The item's own word first ("onion"), while it isn't one of its measures yet; then the kitchen's.
  const own = wordsForName(item.name);
  const ownPick = (item.dimension === "mass" || item.dimension === "volume") && own.sure && !findMeasure(measures, own.one) ? [own] : [];
  const kinds = [...ownPick, ...freeKinds(item.dimension, measures).filter((k) => k.one !== own.one)];
  const first = kinds[0];
  return {
    one: first?.one ?? "",
    many: first?.many ?? "",
    typing: !first,
    picks: kinds.map((k) => ({ one: k.one, many: k.many, label: item.dimension === "pack" ? k.many : k.one })),
    choice: null,
  };
}

/**
 * One question, four quick picks, Save: the size of one measure ("1 onion
 * weighs about" 50 · 100 · 150 · 200 g; "How many slices in a pack?" 10 · 16
 * · 20 · 24). Nothing is picked for you (a wrong guess would move money).
 * The word is the item's name made singular; shown to change when the rule
 * is not sure of it (and for a bottle), picked for a pack (slices · pieces ·
 * packets · type one). Changing a measure offers Remove. One hint: where it
 * is saved, or that past uses stay as they were.
 */
export function MeasureSheet({
  item,
  mode,
  onOpenChange,
  onSaved,
}: {
  item: KitchenItem;
  /** Null: closed. */
  mode: MeasureSheetMode | null;
  onOpenChange: (open: boolean) => void;
  /** After Save (the measures show at once; the server answers later). */
  onSaved?: () => void;
}) {
  return (
    <Sheet open={mode !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(SHEET_CLASS, CLOSE_44)}
        // Focus the sheet itself (or the word, when it is asked), not the first chip: a ring there reads as picked.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const sheet = e.currentTarget as HTMLElement;
          const word = sheet.querySelector<HTMLInputElement>("#measure-word");
          (word ?? sheet).focus();
        }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border min-[900px]:hidden" />
        {mode ? (
          <SheetBody
            key={`${mode.kind}:${mode.kind === "change" ? mode.index : ""}`}
            item={item}
            mode={mode}
            onDone={() => {
              onOpenChange(false);
              onSaved?.();
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ item, mode, onDone }: { item: KitchenItem; mode: MeasureSheetMode; onDone: () => void }) {
  const setMeasures = useSetMeasures();
  const start = React.useMemo(() => startOf(item, mode), [item, mode]);
  const [picked, setPicked] = React.useState<{ one: string; many: string }>({ one: start.one, many: start.many });
  const [typing, setTyping] = React.useState(start.typing);
  const [typed, setTyped] = React.useState(start.typing ? start.one : "");
  const [choice, setChoice] = React.useState<number | null>(start.choice);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const measures = measuresOf(item);
  const dimension = item.dimension;
  const changing = mode.kind === "change" ? (measures[mode.index] ?? null) : null;

  // The word as it stands: the one typed (its plural by the rule, or the name's own plural while it is untouched).
  const words = typing ? (typed.trim() === start.one && start.typing ? { one: start.one, many: start.many } : wordsFor(typed)) : picked;
  const problem = wordProblem(words.one, measures, changing?.one ?? null);
  const base = changing ? choicesForWord(dimension, changing.one) : typing ? SIZE_CHOICES[dimension] : choicesForWord(dimension, words.one);
  const choices = choicesWith(dimension, mode.kind === "first" ? SIZE_CHOICES[dimension] : base, changing ? choiceOf(dimension, changing) : null);
  const ready = choice !== null && problem === null;
  const hint = mode.kind === "first" ? savedForText(words.many || "it", item.pantry) : "Past uses stay as they were.";

  const save = () => {
    if (!ready || choice === null) return;
    const next = measureInput(dimension, words, choice);
    const list = mode.kind === "first" ? [next] : changedMeasures(measures, mode.kind === "change" ? mode.index : null, next);
    void setMeasures({ item, measures: list });
    onDone();
  };
  const remove = () => {
    if (mode.kind !== "change") return;
    void setMeasures({ item, measures: changedMeasures(measures, mode.index, null) });
    onDone();
  };
  const pickWord = (p: { one: string; many: string } | null) => {
    if (p === null) {
      setTyping(true);
      setTyped("");
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setTyping(false);
      setPicked({ one: p.one, many: p.many });
    }
    if (mode.kind !== "first") setChoice(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {start.picks.length > 0 ? (
        <div role="group" aria-label="Count in" className="scrollbar-none -ml-5 mr-11 flex gap-2 overflow-x-auto pl-5 pr-1">
          {start.picks.map((p) => {
            const on = !typing && picked.one === p.one;
            return (
              <button key={p.one} type="button" aria-pressed={on} onClick={() => pickWord(p)} className={cn(PILL, on ? "bg-foreground text-background" : "bg-cp-line text-foreground hover:bg-muted")}>
                {p.label}
              </button>
            );
          })}
          <button type="button" aria-pressed={typing} onClick={() => pickWord(null)} className={cn(PILL, typing ? "bg-foreground text-background" : "bg-cp-line text-foreground hover:bg-muted")}>
            {mode.kind === "add" ? "Type a word" : TYPE}
          </button>
        </div>
      ) : null}
      {typing ? (
        <div className="space-y-1">
          <label htmlFor="measure-word" className="text-[13px] font-normal text-muted-foreground">
            {dimension === "pack" ? "Counted in" : "1 …"}
          </label>
          <input
            ref={inputRef}
            id="measure-word"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={24}
            autoComplete="off"
            autoCapitalize="none"
            placeholder={dimension === "pack" ? "slices" : "onion"}
            aria-invalid={typed.trim() !== "" && problem !== null}
            className="h-12 w-full rounded-[14px] border border-border bg-card px-3.5 text-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
          />
          {typed.trim() !== "" && problem ? <p className="text-[13px] font-normal text-cp-expired">{problem}</p> : null}
        </div>
      ) : null}
      <SheetTitle className="pr-12 text-[22px] font-medium leading-tight tracking-tight">{sizeQuestion(dimension, words.one ? words : { one: "…", many: "…" })}</SheetTitle>
      <div role="group" aria-label="Choices" className="grid grid-cols-4 gap-2">
        {choices.map((c) => {
          const on = choice === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setChoice(c)}
              className={cn(CHIP, on ? "bg-primary text-primary-foreground" : "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80")}
            >
              {choiceLabel(dimension, c)}
            </button>
          );
        })}
      </div>
      <SheetDescription className="text-[13px] font-normal text-muted-foreground">{hint}</SheetDescription>
      <Button type="button" className={cn(MAIN_BUTTON, "min-h-14 text-base font-medium")} disabled={!ready} onClick={save}>
        {saveLabel(dimension, words, choice)}
      </Button>
      {mode.kind === "change" ? (
        <Button type="button" variant="ghost" className="min-h-11 rounded-xl text-[15px] font-medium text-cp-expired" onClick={remove}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}

// ── The item page: Counted as ─────────────────────────────────────

/**
 * "Counted as": each of the item's measures ("1 onion ≈ 150 g · Change") and
 * "Add a measure" (at most three). Viewers see the list without the buttons;
 * with nothing to list, a viewer sees nothing.
 */
export function CountedAs({ item, canWrite, bare = false }: { item: KitchenItem; canWrite: boolean; /** Inside the item page's Measures and note (RV-24): no card of its own, plain 14/400 rows. */ bare?: boolean }) {
  const [mode, setMode] = React.useState<MeasureSheetMode | null>(null);
  const measures: readonly KitchenMeasure[] = measuresOf(item);
  if (measures.length === 0 && !canWrite) return null;
  return (
    <section aria-labelledby="counted-heading" className={bare ? undefined : "rounded-[20px] border bg-card px-4 py-1.5"}>
      <h2 id="counted-heading" className={bare ? "mb-0.5 text-[15px] font-medium" : "mb-0.5 mt-2.5 text-base font-medium"}>
        Counted as
      </h2>
      <ul>
        {measures.map((m, i) => {
          const row = measureRow(m, item.dimension);
          return (
            <li key={m.id} className={cn("flex items-center gap-2.5", bare ? "min-h-12" : "min-h-14 border-b border-border/70")}>
              <span className={cn("min-w-0 flex-1 truncate", bare ? "text-sm font-normal text-muted-foreground" : "text-base font-medium")}>{row.name}</span>
              <span className={cn("shrink-0 tabular-nums text-muted-foreground", bare ? "text-sm font-normal" : "text-[15px] font-normal")}>{row.size}</span>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setMode({ kind: "change", index: i })}
                  aria-label={`Change ${row.name}`}
                  className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium text-cp-accent-text hover:bg-cp-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Change
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canWrite && measures.length < MAX_MEASURES ? (
        <button
          type="button"
          onClick={() => setMode({ kind: "add" })}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add a measure
        </button>
      ) : null}
      <MeasureSheet item={item} mode={mode} onOpenChange={(open) => !open && setMode(null)} />
    </section>
  );
}
