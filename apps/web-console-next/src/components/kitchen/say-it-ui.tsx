"use client";

import * as React from "react";
import type { AiUsesResponse } from "@saas/contracts/kitchen";
import { AI_USES_TEXT_MAX } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { useItemsByRef } from "./pantry-data";
import { useMemberNames } from "./people-data";
import type { AmountPick } from "./amount-picker";
import { AI_EDGE, AiChip } from "./receipt-scan-ui";
import { useLogSaid, useReadSentence } from "./say-it-data";
import { SaidRow, SaidSentence, UnsureRow } from "./say-it-rows-ui";
import {
  SAY_IT_EXAMPLES,
  SAY_IT_PLACEHOLDER,
  SAY_IT_SENT,
  logSaidLabel,
  markSentence,
  proposalPick,
  saidRowView,
  sayItError,
  sentenceToSend,
  type SaidLogRow,
  type SayItError,
} from "./say-it";

/**
 * Say what you used (cookpool-ai AI-7, design §2, the canvas's AiSayIt): the
 * Pantry's "✨ What did you use?" box and Home's ✨ open one sheet. Idle shows
 * the box and example chips; Go reads the sentence (the shimmer while it
 * reads); the result marks what it understood, lists a row per line and
 * the unsure words, and **Log N · ₹total** writes the uses one after
 * another with one Undo (PN-5's Log several). Speak is left out until the
 * server transcribes (AI-5): there is no mic button.
 */

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[26px] border-x-0 bg-card px-[18px] pt-2.5 shadow-2xl focus:outline-none",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
);

/** The shimmer while it reads (still under reduced motion). */
function SayStyles() {
  return (
    <style>{`
@keyframes cookpool-say-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
.cookpool-say-sk{background:linear-gradient(90deg,#ECEEE9 0,#F6F7F4 40px,#ECEEE9 80px);background-size:400px 100%;animation:cookpool-say-shimmer 1.2s linear infinite}
@media (prefers-reduced-motion: reduce){.cookpool-say-sk{animation:none}}
`}</style>
  );
}

/** The Pantry's entry: a box at the top, with the AI edge. */
export function SayItBox({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(AI_EDGE, "flex min-h-[60px] w-full items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-extrabold text-foreground">
          <span aria-hidden>✨ </span>What did you use?
        </span>
        <span className="truncate text-[13px] font-semibold text-muted-foreground">{SAY_IT_PLACEHOLDER}</span>
      </span>
      <AiChip className="hidden min-[360px]:inline-flex" />
    </button>
  );
}

/** Home's ✨ at the end of its field: opens the same sheet. */
export function SayItSparkle({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Say what you used · Cookpool AI"
      className={cn(AI_EDGE, "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
    >
      <span aria-hidden>✨</span>
    </button>
  );
}

type Phase = "idle" | "reading" | "result" | "problem";

export function SayItSheet({ open, onClose, meId, onByHand }: { open: boolean; onClose: () => void; meId: string | null; onByHand: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        {open ? <SayItBody meId={meId} onDone={onClose} onByHand={onByHand} /> : <SheetTitle className="sr-only">What did you use?</SheetTitle>}
        <div aria-hidden className="h-6 shrink-0" />
      </SheetContent>
    </Sheet>
  );
}

function SayItBody({ meId, onDone, onByHand }: { meId: string | null; onDone: () => void; onByHand: () => void }) {
  const names = useMemberNames();
  const read = useReadSentence();
  const logSaid = useLogSaid();
  const [text, setText] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [said, setSaid] = React.useState<{ text: string; res: AiUsesResponse } | null>(null);
  const [error, setError] = React.useState<SayItError | null>(null);
  const [picks, setPicks] = React.useState<Record<number, AmountPick>>({});
  const abort = React.useRef<AbortController | null>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => () => abort.current?.abort(), []);

  const lines = said?.res.lines ?? [];
  const refs = React.useMemo(() => lines.map((l) => l.itemRef), [lines]);
  const items = useItemsByRef(refs);
  const marks = React.useMemo(() => (said ? markSentence(said.text, said.res, { meId, names }) : null), [said, meId, names]);

  const go = (from: string = text) => {
    const sentence = sentenceToSend(from);
    if (!sentence) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setPicks({});
    setSaid({ text: sentence, res: { lines: [], unsure: [] } });
    setPhase("reading");
    void read(sentence, controller.signal).then((r) => {
      if (controller.signal.aborted) return;
      if (!r.ok || (r.data.lines.length === 0 && r.data.unsure.length === 0)) {
        setError(r.ok ? sayItError(null) : sayItError(r.error, r.status));
        setPhase("problem");
        return;
      }
      setSaid({ text: sentence, res: r.data });
      setPhase("result");
    });
  };

  const edit = () => {
    abort.current?.abort();
    setPhase("idle");
    window.requestAnimationFrame(() => box.current?.focus());
  };

  // Every line with its item read and an amount: what Log writes.
  const rows = lines.map((line, i) => {
    const item = items.get(line.itemRef.itemId);
    const pick = item ? (picks[i] ?? proposalPick(item, line)) : null;
    return { line, item, pick, index: i };
  });
  const ready: SaidLogRow[] = rows.flatMap((r) => (r.item && r.pick ? [{ line: r.line, item: r.item, pick: r.pick }] : []));
  const loading = rows.some((r) => r.item === undefined);
  const label = logSaidLabel(ready.map((r) => saidRowView(r.line, r.item, r.pick)));
  const log = () => {
    if (ready.length === 0 || loading) return;
    void logSaid(ready, { meId, names });
    onDone();
  };

  const editing = phase === "idle" || phase === "problem";
  return (
    <div className="flex flex-col gap-3.5">
      <SayStyles />
      <div className="flex items-center gap-2 pr-12">
        <AiChip />
        <SheetTitle className="min-w-0 flex-1 truncate text-xl font-extrabold">What did you use?</SheetTitle>
      </div>

      {editing ? (
        <label className={cn(AI_EDGE, "flex min-h-[76px] flex-col rounded-[18px] px-3.5 py-3 focus-within:ring-2 focus-within:ring-ring")}>
          <span className="sr-only">What did you use?</span>
          <textarea
            ref={box}
            value={text}
            maxLength={AI_USES_TEXT_MAX}
            rows={2}
            autoFocus
            placeholder={SAY_IT_PLACEHOLDER}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                go();
              }
            }}
            className="min-h-[52px] w-full resize-none border-0 bg-transparent p-0 text-[17px] font-semibold leading-[1.5] text-foreground outline-none placeholder:font-semibold placeholder:text-[#7A837D]"
          />
        </label>
      ) : (
        <button type="button" onClick={edit} aria-label="Change the sentence" className={cn(AI_EDGE, "min-h-[76px] rounded-[18px] px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
          {phase === "result" && marks ? <SaidSentence marks={marks} /> : <p className="m-0 text-[17px] font-semibold leading-[1.5]">{said?.text}</p>}
        </button>
      )}

      {phase === "idle" && text.trim() === "" ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Examples">
          {SAY_IT_EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setText(e);
                box.current?.focus();
              }}
              className="min-h-11 rounded-full border border-[#E3E6E0] bg-background px-3 text-[13px] font-bold text-[#3F4842] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}

      {phase === "problem" && error ? (
        <p role="alert" className="rounded-2xl bg-[#FDF1D6] px-4 py-3 text-[15px] font-extrabold text-[#5C3D00]">
          {error.title}
        </p>
      ) : null}

      {phase === "result" ? null : (
        <div className="flex gap-2">
          {phase === "problem" ? (
            <button type="button" onClick={onByHand} className="min-h-[52px] flex-1 rounded-2xl border border-[#D5DAD2] bg-card text-base font-extrabold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Log by hand
            </button>
          ) : null}
          {phase !== "problem" || error?.kind === "failed" ? (
            <button
              type="button"
              disabled={phase === "reading" || sentenceToSend(text) === null}
              onClick={() => go()}
              className="min-h-[52px] flex-1 rounded-2xl bg-[#17201B] text-base font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
            >
              {phase === "problem" ? "Try again" : "Go"}
            </button>
          ) : null}
        </div>
      )}

      {phase === "reading" ? (
        <div className="flex flex-col gap-2.5" role="status">
          <span className="text-[13px] font-extrabold text-[#165C3A]">Reading your sentence…</span>
          <span aria-hidden className="cookpool-say-sk h-14 rounded-lg" />
          <span aria-hidden className="cookpool-say-sk h-14 rounded-lg" />
        </div>
      ) : null}

      {phase === "result" && said && marks ? (
        <>
          <div className="flex flex-col gap-2">
            {lines.length > 0 ? <span className="text-xs font-extrabold tracking-[0.06em] text-muted-foreground">HERE&apos;S WHAT I GOT · TAP TO CHANGE</span> : null}
            {rows.map((r) => (
              <SaidRow
                key={`${r.index}:${r.line.itemRef.itemId}`}
                line={r.line}
                item={r.item}
                pick={r.pick}
                heard={marks.heard[r.index] ?? null}
                meId={meId}
                names={names}
                onPick={(next) => setPicks((p) => ({ ...p, [r.index]: next }))}
              />
            ))}
            {said.res.unsure.map((u) => (
              <UnsureRow key={u} said={u} />
            ))}
          </div>
          {ready.length > 0 ? (
            <button
              type="button"
              disabled={loading}
              onClick={log}
              className="min-h-[58px] rounded-[18px] bg-primary text-[17px] font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {label}
            </button>
          ) : null}
          <button type="button" onClick={() => go(said.text)} className="min-h-11 self-center rounded-xl px-3 text-sm font-extrabold text-[#165C3A] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Read again
          </button>
          <span className="text-center text-xs font-semibold text-muted-foreground">{SAY_IT_SENT}</span>
        </>
      ) : null}
    </div>
  );
}
