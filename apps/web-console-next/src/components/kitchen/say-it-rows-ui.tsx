"use client";

import * as React from "react";
import Link from "./link";
import { Minus, Plus } from "lucide-react";
import type { AiUseProposal, KitchenItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Face } from "./faces-ui";
import type { MemberNames } from "./members";
import { RepeatButton } from "./row-gestures-ui";
import { AmountPicker } from "./amount-picker-ui";
import { pickStep, type AmountPick } from "./amount-picker";
import { AI_EDGE } from "./receipt-scan-ui";
import { addItHref, saidRowView, type SaidMarks } from "./say-it";

/**
 * Say what you used's result (cookpool-ai AI-7, the canvas's AiSayIt): the
 * sentence with what was understood marked, one row per line read — the
 * green dot, the name, PN-11's amount in compact form (− [amount] +; a tap
 * on the amount opens the whole control, unit chips and typing), the faces
 * of who had it, its pantry and cost, and what it heard in grey — and each
 * unsure word as an amber row with Add it.
 */

const STEP = "grid h-11 w-11 shrink-0 place-items-center bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/** The sentence, its understood parts marked green and its unsure words amber. */
export function SaidSentence({ marks }: { marks: SaidMarks }) {
  return (
    <p className="m-0 text-[17px] font-semibold leading-[1.5] text-foreground">
      {marks.spans.map((s, i) =>
        s.tone === "plain" ? (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ) : (
          <mark key={i} className={cn("rounded-md px-[3px] text-foreground", s.tone === "matched" ? "bg-[#E4F2EA]" : "bg-[#FDF1D6]")}>
            {s.text}
          </mark>
        ),
      )}
    </p>
  );
}

/** One line read: loading, gone (it can't be read now), or the row with its amount. */
export function SaidRow({
  line,
  item,
  pick,
  heard,
  meId,
  names,
  onPick,
}: {
  line: AiUseProposal;
  /** Missing while it loads; null when it can't be read now. */
  item: KitchenItem | null | undefined;
  pick: AmountPick | null;
  heard: string | null;
  meId: string | null;
  names: MemberNames;
  onPick: (next: AmountPick) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (item === undefined) return <div aria-hidden className="cookpool-say-sk h-[76px] rounded-[18px]" />;
  if (item === null || pick === null) {
    return (
      <div className="flex min-h-14 items-center gap-2.5 rounded-[18px] border border-[#E3E6E0] bg-card px-3 py-2 text-sm font-bold text-muted-foreground">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#C9CFC6]" />
        <span className="min-w-0 flex-1">{line.name} · none left to log now</span>
      </div>
    );
  }
  const view = saidRowView(line, item, pick);
  return (
    <div className={cn(AI_EDGE, "flex flex-col gap-1.5 rounded-[18px] px-3 py-2.5")}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#1F7A4D]" />
        <span className="min-w-0 flex-1 truncate text-base font-extrabold">{view.name}</span>
        <span className="flex shrink-0 items-center overflow-hidden rounded-xl border border-[#D5DAD2]">
          <RepeatButton aria-label={`Less ${view.name}`} className={STEP} disabled={!view.canLess} onStep={() => onPick(pickStep(item, pick, -1))}>
            <Minus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
          </RepeatButton>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${view.amount} of ${view.name} · change`}
            onClick={() => setOpen((o) => !o)}
            className="h-11 min-w-[76px] max-w-[112px] truncate px-1 text-center text-sm font-extrabold tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {view.amount}
          </button>
          <RepeatButton aria-label={`More ${view.name}`} className={STEP} disabled={!view.canMore} onStep={() => onPick(pickStep(item, pick, 1))}>
            <Plus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
          </RepeatButton>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 pl-5">
        <span aria-hidden className="flex shrink-0 -space-x-1.5">
          {(view.consumers.length > 0 ? view.consumers : meId ? [meId] : []).slice(0, 4).map((id) => (
            <Face key={id} subjectId={id} meId={meId} names={names} className="h-6 w-6 text-[10px] ring-2 ring-card" />
          ))}
        </span>
        <span className="min-w-0 flex-1 text-xs font-bold leading-snug tabular-nums text-muted-foreground">{view.sub}</span>
        {heard ? <span className="max-w-[42%] shrink-0 truncate text-xs font-bold text-[#7A837D]">&ldquo;{heard}&rdquo;</span> : null}
      </div>
      {view.note ? <span className="pl-5 text-xs font-bold text-[#8A5A00]">{view.note}</span> : null}
      {open ? <AmountPicker item={item} name={view.name} pick={pick} start={null} why={null} onPick={onPick} className="pt-1.5" /> : null}
    </div>
  );
}

/** A word that matched nothing: amber, with Add it (the add form, its name filled in). */
export function UnsureRow({ said }: { said: string }) {
  return (
    <div className="flex min-h-14 items-center gap-2.5 rounded-[18px] bg-[#FDF1D6] px-3 py-2">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#D97706]" />
      <span className="min-w-0 flex-1 text-sm font-bold text-[#5C3D00]">&ldquo;{said}&rdquo; isn&apos;t in your pantries</span>
      <Link
        href={addItHref(said)}
        className="flex min-h-11 shrink-0 items-center rounded-[10px] border border-[#E8C77A] bg-card px-3 text-[13px] font-extrabold text-[#5C3D00] hover:bg-[#FFF8E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Add it
      </Link>
    </div>
  );
}
