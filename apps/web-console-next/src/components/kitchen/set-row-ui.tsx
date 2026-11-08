"use client";

import * as React from "react";
import { Check, History, Minus, Plus } from "lucide-react";
import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { useItemMoves, useLogUse, useMembersOf } from "./pantry-data";
import { useMemberNames } from "./people-data";
import { RepeatButton } from "./row-gestures-ui";
import { faceColor, faceOrder, toggleFace } from "./faces";
import { memberInitials, memberLabel, type MemberNames } from "./members";
import { orderConsumers } from "./item-use";
import { usePantryDrafts, saveDraft } from "@/lib/pantry-device";
import type { PantryRow } from "./pantry-list";
import { useAskToUse, useCancelAsk } from "./ask-data";
import { askButtonText, type AskStatus } from "./ask-before-use";
import { ASK_BUTTON, AskLockIcon, AskWaitBox } from "./ask-ui";
import {
  canStep,
  draftOf,
  draftStep,
  lastLine,
  setConsumers,
  setCostLine,
  setReason,
  stepFrom,
  withStep,
  type LadderStep,
} from "./pantry-set";

/** Faces the set row shows before "+N" (which opens the sheet's full row). */
const SET_FACES = 4;

const STEP = "grid h-[52px] w-12 shrink-0 place-items-center rounded-[14px] border border-[#C9CFC6] bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/** The row's amount and people as the device keeps them (the set row and the sheet share them). */
export function useSetState(row: PantryRow, item: ReachableItem, roster: readonly string[] | null, meId: string | null) {
  const drafts = usePantryDrafts();
  const draft = drafts[item.id] ?? null;
  const fromDraft = draftStep(row.ladder.steps, draft, item);
  const steps = fromDraft ? withStep(row.ladder.steps, fromDraft) : row.ladder.steps;
  const step: LadderStep | null = fromDraft ?? row.ladder.suggestion?.step ?? steps[0] ?? null;
  const consumers = orderConsumers(
    setConsumers({ item, draft: draft?.consumers ?? null, suggestion: row.ladder.suggestion, roster, meId }),
    roster ?? [],
    meId,
  );
  const keep = (next: LadderStep, people: readonly string[] | null) => saveDraft(item.id, draftOf(next, people, new Date()));
  return {
    steps,
    step,
    consumers,
    /** Set the amount (the people stay). */
    pick: (next: LadderStep) => keep(next, draft?.consumers ?? null),
    /** Set the people (the amount stays). */
    people: (next: readonly string[]) => step && keep(step, next),
    /** Logged: forget it. */
    clear: () => saveDraft(item.id, null),
  };
}

/**
 * The open row (design §1.1, "the set row"): Last; − [amount] + stepping
 * the ladder, from the suggestion with its reason under it ("Morning
 * usual", or "Changed from 1 glass" once moved); for a group's item, the
 * faces (the people from last time) and what it costs each; ✓ Use, which
 * logs it with the Undo toast and closes the row; More…, the sheet. What
 * it is left at is kept on the device until Use.
 */
export function SetRow({
  row,
  item,
  usual,
  meId,
  names: knownNames,
  onMore,
  onLogged,
  askName = null,
  askStatus = null,
}: {
  row: PantryRow;
  item: ReachableItem;
  usual: KitchenUsual | null;
  meId: string | null;
  names: MemberNames;
  onMore: () => void;
  onLogged: () => void;
  /** Ask before use (cookpool-pantry PN-9): who you must ask; the main button then reads "Ask Meera" and asks. */
  askName?: string | null;
  /** Your ask for it: while it waits, the row shows it with Cancel instead of the amount. */
  askStatus?: AskStatus | null;
}) {
  const me = meId;
  const orgId = item.pantry.kind === "group" ? item.pantry.orgId : null;
  const members = useMembersOf(orgId);
  const groupNames = useMemberNames(members.data);
  const names = orgId ? groupNames : knownNames;
  const roster = React.useMemo(() => (orgId && members.data ? members.data.map((m) => m.subjectId) : null), [orgId, members.data]);
  const moves = useItemMoves(row.ref);
  const logUse = useLogUse();
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const set = useSetState(row, item, roster, me);
  const { step, steps, consumers } = set;
  if (!step) return null;
  const asking = row.variant === "ask" && askName !== null && row.ref.kind === "group";

  const personal = item.pantry.kind === "personal";
  const last = lastLine({ moves: moves.data, usual, item, meId: me, names, now: new Date() });
  const reason = setReason(step, row.ladder.suggestion);
  const ready = personal || consumers.length > 0;
  const faces = roster ? faceOrder(roster, me, names) : consumers;
  const shown = faces.slice(0, SET_FACES);
  // Anyone chosen further down stays shown.
  for (const id of consumers) if (!shown.includes(id)) shown.push(id);
  const more = faces.length - shown.filter((id) => faces.includes(id)).length;

  const use = () => {
    if (!ready) return;
    if (asking && row.ref.kind === "group" && askName) {
      // You must ask first: the same amount and people go to the buyer as an ask (nothing comes off yet).
      void askToUse({
        ref: row.ref,
        item,
        qtyMilli: step.qtyMilli,
        consumers,
        idempotencyKey: crypto.randomUUID(),
        what: step.words,
        measure: step.amount.kind === "measure" ? { measure: step.amount.measure, quantity: step.amount.quantity } : null,
        meId: me,
        names,
        who: askName,
      });
      set.clear();
      return;
    }
    void logUse({
      ref: row.ref,
      item,
      qtyMilli: step.qtyMilli,
      consumers,
      idempotencyKey: crypto.randomUUID(),
      what: step.words,
      measure: step.amount.kind === "measure" ? { measure: step.amount.measure, quantity: step.amount.quantity } : null,
      meId: me,
      names,
    });
    set.clear();
    onLogged();
  };

  if (askStatus?.phase === "waiting") {
    return (
      <div className="flex flex-col gap-2.5 px-3 pb-3.5">
        <AskWaitBox status={askStatus} onCancel={() => void cancelAsk(askStatus.ask)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-3 pb-3.5">
      {last ? (
        <p className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-muted-foreground">
          <History className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{last}</span>
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <RepeatButton aria-label={`Less ${row.name}`} className={STEP} disabled={!canStep(steps, step.key, -1)} onStep={() => set.pick(stepFrom(steps, step.key, -1) ?? step)}>
          <Minus className="h-5 w-5" aria-hidden />
        </RepeatButton>
        <span className="flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center rounded-[14px] border-[1.5px] border-primary bg-background px-2">
          <span role="status" className="max-w-full truncate text-lg font-extrabold tabular-nums">
            {step.words}
          </span>
          {reason ? <span className="max-w-full truncate text-xs font-bold text-[#165C3A]">{reason}</span> : null}
        </span>
        <RepeatButton aria-label={`More ${row.name}`} className={STEP} disabled={!canStep(steps, step.key, 1)} onStep={() => set.pick(stepFrom(steps, step.key, 1) ?? step)}>
          <Plus className="h-5 w-5" aria-hidden />
        </RepeatButton>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {personal ? null : (
          <div role="group" aria-label="Who had it" className="flex min-w-0 shrink-0 flex-wrap gap-1">
            {shown.map((id) => {
              const on = consumers.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  aria-label={memberLabel(id, me, names)}
                  onClick={() => set.people([...toggleFace(new Set(consumers), id)])}
                  className="grid h-11 w-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    style={{ backgroundColor: faceColor(id, me), ...(on ? { boxShadow: "0 0 0 2px hsl(var(--background)), 0 0 0 4px #17201B" } : {}) }}
                    className={cn("grid h-10 w-10 place-items-center rounded-full text-[13px] font-extrabold text-white", !on && "opacity-40")}
                  >
                    {memberInitials(id, me, names)}
                  </span>
                </button>
              );
            })}
            {more > 0 ? (
              <button
                type="button"
                onClick={onMore}
                aria-label={`${more} more people`}
                className="grid h-11 w-11 place-items-center rounded-full border-2 border-dashed border-input text-[13px] font-extrabold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                +{more}
              </button>
            ) : null}
          </div>
        )}
        <span className="min-w-0 flex-1 text-right text-[13px] font-bold leading-tight tabular-nums text-foreground/80">
          {ready ? setCostLine(item, step.qtyMilli, consumers) : "Pick who had it"}
        </span>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-2">
        {asking && askName ? (
          <button type="button" disabled={!ready} onClick={use} className={ASK_BUTTON}>
            <AskLockIcon />
            <span className="truncate">{askButtonText(askName)}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={use}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-primary text-base font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Check className="h-5 w-5" strokeWidth={2.8} aria-hidden />
            Use
          </button>
        )}
        <button
          type="button"
          onClick={onMore}
          className="min-h-[52px] rounded-[14px] border border-[#C9CFC6] bg-card text-[15px] font-extrabold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          More…
        </button>
      </div>
    </div>
  );
}
