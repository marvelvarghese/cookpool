"use client";

import * as React from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import {
  MAX_RECIPE_STEP,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TOOL,
  MAX_RECIPE_TOOLS,
  MAX_STEP_CHECKPOINT,
  MAX_STEP_TIP,
  STEP_SENSES,
  STEP_TIME_RULES,
  type StepHeat,
} from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { K_BUTTON_QUIET, K_INPUT } from "./kit";
import { HEAT_LABELS, RULE_LABELS, SENSE_LABELS, whistlesText } from "./guided-steps";
import {
  draftTimeText,
  pickHeat,
  pickSense,
  pickTimeKind,
  stepPreview,
  stepRange,
  stepSummary,
  stepWhistles,
  toggleStepLine,
  type StepDraft,
  type StepFieldErrors,
  type StepPreview,
  type StepTimeKind,
} from "./step-editor";
import { toolProblem, type RecipeFormErrors } from "./recipe-form";
import { minutesText } from "./recipes";

/**
 * The recipe form's guided parts (cookpool-guided GC-6, the canvas's
 * `GuideEditor`): Tools at the form's top, and the Steps — each a row that
 * opens into the step editor (Prep | Cook, What to do, Goes in now, Flame,
 * Time in minutes or whistles with Hands off and More food takes, Done when,
 * Tip) with a live preview of what the cook sees at the recipe's size.
 */

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-medium text-destructive">
      {message}
    </p>
  );
}

const ICON_BUTTON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30";

const STEPPER =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card text-xl font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

const SMALL_HEAD = "text-xs font-medium tracking-[0.04em] text-muted-foreground";

/** A pill that is on or off (the flame, the rule, the sense): dark when on. */
function pill(on: boolean): string {
  return cn(
    "min-h-11 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    on ? "bg-cp-accent-tint text-cp-accent-text" : "bg-muted text-foreground hover:bg-accent",
  );
}

/** One half of a segmented control (Prep | Cook, None | Minutes | Whistles): white when on. */
function segment(on: boolean): string {
  return cn(
    "min-h-10 rounded-[10px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    on ? "bg-card text-foreground shadow-cp-card" : "bg-transparent text-muted-foreground hover:text-foreground",
  );
}

// ── Tools ─────────────────────────────────────────────────────────

/** Tools: a short list of names (up to 10), each with its ×, and a field to add one. */
export function ToolsEditor({
  tools,
  errors,
  error,
  onAdd,
  onRemove,
}: {
  tools: readonly string[];
  errors: Record<number, string>;
  error: string | undefined;
  onAdd: (name: string) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const add = () => {
    const why = toolProblem(tools, draft);
    if (why) {
      setProblem(draft.trim() ? why : null);
      return;
    }
    onAdd(draft);
    setDraft("");
    setProblem(null);
  };
  const full = tools.length >= MAX_RECIPE_TOOLS;
  const toolError = Object.entries(errors)[0];
  return (
    <section aria-labelledby="recipe-tools-h" className="flex flex-col gap-2.5" data-field="tools">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recipe-tools-h" className="text-lg font-medium tracking-tight">
          Tools
        </h2>
        <span className="text-[13px] font-normal tabular-nums text-muted-foreground">
          {tools.length} of {MAX_RECIPE_TOOLS}
        </span>
      </div>
      {tools.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {tools.map((tool, i) => (
            <li
              key={`${tool}-${i}`}
              className={cn(
                "flex min-h-11 items-center gap-1 rounded-full bg-card pl-3.5 pr-1 text-[15px] font-medium shadow-cp-card",
                errors[i] ? "border border-destructive text-destructive" : "",
              )}
            >
              {tool}
              <button type="button" aria-label={`Remove ${tool}`} onClick={() => onRemove(i)} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {toolError ? <FieldError id="recipe-tool-error" message={`${tools[Number(toolError[0])] ?? "A tool"}: ${toolError[1]}`} /> : null}
      <FieldError id="recipe-tools-error" message={error} />
      {!full ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="recipe-tool-new" className="sr-only">
              A tool
            </Label>
            <Input
              id="recipe-tool-new"
              value={draft}
              maxLength={MAX_RECIPE_TOOL}
              autoComplete="off"
              placeholder={tools.length === 0 ? "Kadai with a lid" : "Pressure cooker"}
              onChange={(e) => {
                setDraft(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              aria-invalid={!!problem}
              aria-describedby={problem ? "recipe-tool-new-error" : undefined}
              className={K_INPUT}
            />
            <FieldError id="recipe-tool-new-error" message={problem ?? undefined} />
          </div>
          <Button type="button" variant="ghost" className={cn(K_BUTTON_QUIET, "h-11 gap-1.5 rounded-xl px-4")} onClick={add}>
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
            Add
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ── Steps ─────────────────────────────────────────────────────────

/** A line a step can name: the form's key, the line's words, and its chip as written. */
export interface StepLineChoice {
  key: string;
  name: string;
  chip: string;
}

/**
 * Steps · N: each a row (its number, words and what is set: "Medium flame ·
 * 8–10 min · Until golden brown") that opens into the step editor; a step
 * with an error is held open, so the error shows. Up to 20 steps.
 */
export function StepsEditor({
  steps,
  choices,
  servesHalf,
  errors,
  checks,
  onAdd,
  onText,
  onChange,
  onRemove,
}: {
  steps: readonly StepDraft[];
  choices: readonly StepLineChoice[];
  servesHalf: number;
  errors: Pick<RecipeFormErrors, "step" | "stepField" | "steps">;
  /** Things to look at again, by step index (cookpool-ai AI-9: a photo's checks): an amber outline and "⚠ message". */
  checks?: Readonly<Record<number, string>> | undefined;
  /** Adds a step and gives the form's id for it (it opens). */
  onAdd: () => string | null;
  onText: (index: number, text: string) => void;
  onChange: (id: string, change: (d: StepDraft) => StepDraft) => void;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chipOf = React.useMemo(() => {
    const byKey = new Map(choices.map((c) => [c.key, c.chip] as const));
    return (key: string) => byKey.get(key) ?? null;
  }, [choices]);

  return (
    <section aria-labelledby="recipe-steps-h" className="flex flex-col gap-2.5" data-field="steps">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recipe-steps-h" className="text-lg font-medium tracking-tight">
          Steps{steps.length > 0 ? ` · ${steps.length}` : ""}
        </h2>
        <span className="text-[13px] font-normal tabular-nums text-muted-foreground">
          {steps.length} of {MAX_RECIPE_STEPS}
        </span>
      </div>
      {steps.length > 0 ? (
        <ol className="flex flex-col gap-2.5">
          {steps.map((d, i) => {
            const fieldErrors = errors.stepField[i] ?? {};
            const textError = errors.step[i];
            const isOpen = open.has(d.id) || textError !== undefined || Object.keys(fieldErrors).length > 0;
            return (
              <li key={d.id}>
                <StepRowEditor
                  draft={d}
                  index={i}
                  open={isOpen}
                  choices={choices}
                  preview={stepPreview(d, servesHalf, chipOf)}
                  textError={textError}
                  fieldErrors={fieldErrors}
                  check={checks?.[i]}
                  onToggle={() => toggle(d.id)}
                  onText={(text) => onText(i, text)}
                  onChange={(change) => onChange(d.id, change)}
                  onRemove={() => onRemove(i)}
                />
              </li>
            );
          })}
        </ol>
      ) : null}
      <FieldError id="recipe-steps-error" message={errors.steps} />
      {steps.length < MAX_RECIPE_STEPS ? (
        <Button
          type="button"
          variant="ghost"
          className={cn(K_BUTTON_QUIET, "h-12 gap-2 self-start")}
          onClick={() => {
            const id = onAdd();
            if (!id) return;
            setOpen((cur) => new Set(cur).add(id));
            window.requestAnimationFrame(() => document.getElementById(`${id}-text`)?.focus());
          }}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          Add a step
        </Button>
      ) : null}
    </section>
  );
}

/** One step: its row, and — open — the editor under it. */
function StepRowEditor({
  draft: d,
  index,
  open,
  choices,
  preview,
  textError,
  fieldErrors,
  check,
  onToggle,
  onText,
  onChange,
  onRemove,
}: {
  check?: string | undefined;
  draft: StepDraft;
  index: number;
  open: boolean;
  choices: readonly StepLineChoice[];
  preview: StepPreview;
  textError: string | undefined;
  fieldErrors: Omit<StepFieldErrors, "text">;
  onToggle: () => void;
  onText: (text: string) => void;
  onChange: (change: (d: StepDraft) => StepDraft) => void;
  onRemove: () => void;
}) {
  const id = d.id;
  const n = index + 1;
  const summary = stepSummary(d);
  const words = d.text.trim();
  return (
    <div
      id={`${id}-step`}
      role="group"
      aria-label={`Step ${n}`}
      className={cn("overflow-hidden rounded-[18px] bg-card shadow-cp-card", check && "ring-[1.5px] ring-cp-soon")}
    >
      <div className="flex items-start gap-1 p-2 pl-3">
        <span
          aria-hidden
          className={cn(
            "mt-2.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-medium",
            d.handsOff ? "bg-cp-line text-muted-foreground" : "bg-cp-accent-tint text-cp-accent-text",
          )}
        >
          {n}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-editor`}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("line-clamp-2 text-[15px] font-medium leading-snug", !words && "text-muted-foreground")}>{words || "Say what to do"}</span>
          <span className="text-[13px] font-normal text-muted-foreground">{summary ?? (open ? "Text only" : "Add flame, time and when it's done")}</span>
          {check ? <span className="text-xs font-medium text-cp-soon">⚠ {check}</span> : null}
        </button>
        <ChevronDown aria-hidden className={cn("mt-3 h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        <button type="button" aria-label={`Remove step ${n}`} onClick={onRemove} className={ICON_BUTTON}>
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {open ? (
        <div id={`${id}-editor`} className="flex flex-col gap-4 border-t border-cp-line bg-background p-3.5">
          <StepFields draft={d} n={n} choices={choices} textError={textError} fieldErrors={fieldErrors} onText={onText} onChange={onChange} />
          <PreviewCard preview={preview} />
        </div>
      ) : null}
    </div>
  );
}

const TIME_KINDS: readonly { kind: StepTimeKind; label: string }[] = [
  { kind: "none", label: "None" },
  { kind: "minutes", label: "Minutes" },
  { kind: "whistles", label: "Whistles" },
];

/** The editor's fields, in the canvas's order. */
function StepFields({
  draft: d,
  n,
  choices,
  textError,
  fieldErrors: e,
  onText,
  onChange,
}: {
  draft: StepDraft;
  n: number;
  choices: readonly StepLineChoice[];
  textError: string | undefined;
  fieldErrors: Omit<StepFieldErrors, "text">;
  onText: (text: string) => void;
  onChange: (change: (d: StepDraft) => StepDraft) => void;
}) {
  const id = d.id;
  const set = (patch: Partial<StepDraft>) => onChange((cur) => ({ ...cur, ...patch }));
  return (
    <>
      <div>
        <div role="group" aria-label={`Step ${n}: when`} className="grid grid-cols-2 rounded-[14px] bg-muted p-[3px]">
          {(["prep", "cook"] as const).map((phase) => (
            <button key={phase} type="button" aria-pressed={d.phase === phase} onClick={() => set({ phase })} className={segment(d.phase === phase)}>
              {phase === "prep" ? "Prep" : "Cook"}
            </button>
          ))}
        </div>
        <FieldError id={`${id}-phase-error`} message={e.phase} />
      </div>

      <div>
        <Label htmlFor={`${id}-text`} className="mb-1.5 block text-[13px] font-medium">
          What to do
        </Label>
        <textarea
          id={`${id}-text`}
          value={d.text}
          rows={2}
          maxLength={MAX_RECIPE_STEP}
          placeholder={n === 1 ? "Add the onions and a pinch of salt. Stir now and then." : ""}
          onChange={(ev) => onText(ev.target.value)}
          aria-invalid={!!textError}
          aria-describedby={textError ? `${id}-text-error` : undefined}
          className="min-h-[70px] w-full resize-none rounded-[14px] border border-input bg-background px-3 py-2.5 text-base font-normal leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <FieldError id={`${id}-text-error`} message={textError} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={`${id}-lines-h`} className={SMALL_HEAD}>
          GOES IN NOW · AMOUNTS FOLLOW THE SIZE
        </span>
        {choices.length > 0 ? (
          <div role="group" aria-labelledby={`${id}-lines-h`} className="flex flex-wrap gap-2">
            {choices.map((c) => {
              const on = d.lines.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange((cur) => toggleStepLine(cur, c.key))}
                  className={cn(
                    "min-h-10 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "bg-cp-accent-tint text-cp-accent-text" : "border border-dashed border-border bg-card text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span aria-hidden>{on ? "✓ " : "+ "}</span>
                  {c.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] font-normal text-muted-foreground">Name the ingredients above, then attach the ones this step uses.</p>
        )}
        <FieldError id={`${id}-lines-error`} message={e.lines} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={`${id}-heat-h`} className="text-[13px] font-medium">
          Flame
        </span>
        <div role="group" aria-labelledby={`${id}-heat-h`} className="grid grid-cols-4 gap-1.5">
          {HEAT_LABELS.map((label, heat) => (
            <button key={label} type="button" aria-pressed={d.heat === heat} onClick={() => onChange((cur) => pickHeat(cur, heat as StepHeat))} className={pill(d.heat === heat)}>
              {label}
            </button>
          ))}
        </div>
        <FieldError id={`${id}-heat-error`} message={e.heat} />
      </div>

      <TimeCard draft={d} fieldErrors={e} onChange={onChange} />

      <div className="flex flex-col gap-2 rounded-[18px] bg-card p-3.5 shadow-cp-card">
        <span id={`${id}-sense-h`} className="text-[13px] font-medium">
          Done when
        </span>
        <div role="group" aria-labelledby={`${id}-sense-h`} className="flex flex-wrap gap-1.5">
          {STEP_SENSES.map((sense) => (
            <button key={sense} type="button" aria-pressed={d.sense === sense} onClick={() => onChange((cur) => pickSense(cur, sense))} className={pill(d.sense === sense)}>
              {SENSE_LABELS[sense]}
            </button>
          ))}
        </div>
        <Label htmlFor={`${id}-checkpoint`} className="sr-only">
          What to watch for
        </Label>
        <Input
          id={`${id}-checkpoint`}
          value={d.checkpoint}
          maxLength={MAX_STEP_CHECKPOINT}
          autoComplete="off"
          placeholder="golden brown"
          onChange={(ev) => set({ checkpoint: ev.target.value })}
          aria-invalid={!!e.checkpoint}
          aria-describedby={e.checkpoint ? `${id}-checkpoint-error` : undefined}
          className={cn(K_INPUT, "h-12 font-medium sm:h-12")}
        />
        <FieldError id={`${id}-checkpoint-error`} message={e.checkpoint} />
      </div>

      <div>
        <Label htmlFor={`${id}-tip`} className="mb-1.5 block text-[13px] font-medium">
          Tip <span className="font-normal text-muted-foreground">· optional</span>
        </Label>
        <Input
          id={`${id}-tip`}
          value={d.tip}
          maxLength={MAX_STEP_TIP}
          autoComplete="off"
          placeholder="Don't rush them: browner onions, deeper curry."
          onChange={(ev) => set({ tip: ev.target.value })}
          aria-invalid={!!e.tip}
          aria-describedby={e.tip ? `${id}-tip-error` : undefined}
          className={K_INPUT}
        />
        <FieldError id={`${id}-tip-error`} message={e.tip} />
      </div>
    </>
  );
}

/** Time: None | Minutes | Whistles, the range (shortest to longest) or the whistles, Hands off, and More food takes. */
function TimeCard({
  draft: d,
  fieldErrors: e,
  onChange,
}: {
  draft: StepDraft;
  fieldErrors: Omit<StepFieldErrors, "text">;
  onChange: (change: (d: StepDraft) => StepDraft) => void;
}) {
  const id = d.id;
  const time = draftTimeText(d);
  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-card p-3.5 shadow-cp-card">
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${id}-time-h`} className="flex-1 text-[13px] font-medium">
          Time{time ? <span className="font-normal text-muted-foreground"> · {time}</span> : null}
        </span>
        <div role="group" aria-labelledby={`${id}-time-h`} className="flex rounded-xl bg-muted p-[3px]">
          {TIME_KINDS.map(({ kind, label }) => (
            <button key={kind} type="button" aria-pressed={d.timeKind === kind} onClick={() => onChange((cur) => pickTimeKind(cur, kind))} className={segment(d.timeKind === kind)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {d.timeKind === "minutes" ? (
        <div className="flex flex-col gap-2">
          <TimeStepper label="Shortest" value={minutesText(Math.max(1, Math.round(d.minSeconds / 60)))} onLess={() => onChange((cur) => stepRange(cur, "min", -1))} onMore={() => onChange((cur) => stepRange(cur, "min", 1))} lessDisabled={d.minSeconds <= 60} />
          <TimeStepper label="Longest" value={minutesText(Math.max(1, Math.round(d.maxSeconds / 60)))} onLess={() => onChange((cur) => stepRange(cur, "max", -1))} onMore={() => onChange((cur) => stepRange(cur, "max", 1))} lessDisabled={d.maxSeconds <= 60} />
        </div>
      ) : d.timeKind === "whistles" ? (
        <TimeStepper label="Whistles" value={whistlesText(d.whistles)} onLess={() => onChange((cur) => stepWhistles(cur, -1))} onMore={() => onChange((cur) => stepWhistles(cur, 1))} lessDisabled={d.whistles <= 1} />
      ) : null}
      <FieldError id={`${id}-time-error`} message={e.time} />

      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <span className="flex flex-1 flex-col">
          <span className="text-[15px] font-medium">Hands off</span>
          <span className="text-xs font-normal text-muted-foreground">The cook can do the next steps meanwhile</span>
        </span>
        <Switch checked={d.handsOff} onCheckedChange={(handsOff) => onChange((cur) => ({ ...cur, handsOff }))} aria-label="Hands off" />
      </label>
      <FieldError id={`${id}-handsoff-error`} message={e.handsOff} />

      {d.timeKind === "minutes" ? (
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-rule-h`} className={SMALL_HEAD}>
            MORE FOOD TAKES
          </span>
          <div role="group" aria-labelledby={`${id}-rule-h`} className="grid grid-cols-3 gap-1.5">
            {STEP_TIME_RULES.map((rule) => (
              <button key={rule} type="button" aria-pressed={d.timeRule === rule} onClick={() => onChange((cur) => ({ ...cur, timeRule: rule }))} className={cn(pill(d.timeRule === rule), "px-2")}>
                {RULE_LABELS[rule]}
              </button>
            ))}
          </div>
          <FieldError id={`${id}-rule-error`} message={e.timeRule} />
        </div>
      ) : null}
    </div>
  );
}

/** − value + for one end of a range, or the whistles. */
function TimeStepper({ label, value, onLess, onMore, lessDisabled }: { label: string; value: string; onLess: () => void; onMore: () => void; lessDisabled: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[13px] font-normal text-muted-foreground">{label}</span>
      <button type="button" aria-label={`${label}: less`} disabled={lessDisabled} onClick={onLess} className={STEPPER}>
        −
      </button>
      <span aria-live="polite" className="flex-1 text-center text-lg font-medium tabular-nums">
        {value}
      </span>
      <button type="button" aria-label={`${label}: more`} onClick={onMore} className={STEPPER}>
        +
      </button>
    </div>
  );
}

/** What the cook sees, at the recipe's own size: the flame and time in words, the text and chips, the checkpoint. */
export function PreviewCard({ preview }: { preview: StepPreview }) {
  return (
    <section aria-label="Preview" className="flex flex-col gap-1.5">
      <span className={cn(SMALL_HEAD, "uppercase")}>{preview.label}</span>
      <div className="flex flex-col gap-2 rounded-[18px] bg-card p-3.5 shadow-cp-card">
        {preview.heading || preview.phase ? (
          <span className="text-[13px] font-medium text-cp-accent-text">{[preview.phase, preview.heading].filter(Boolean).join(" · ")}</span>
        ) : null}
        <span className="text-lg font-medium leading-snug">{preview.text}</span>
        {preview.chips.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {preview.chips.map((chip, i) => (
              <span key={`${chip}-${i}`} className="rounded-full bg-muted px-2.5 py-1 text-[13px] font-medium">
                {chip}
              </span>
            ))}
          </span>
        ) : null}
        {preview.checkpoint ? <span className="text-sm font-normal text-muted-foreground">{preview.checkpoint}</span> : null}
        {preview.tip ? <span className="text-[13px] font-normal text-muted-foreground">{preview.tip}</span> : null}
      </div>
    </section>
  );
}
