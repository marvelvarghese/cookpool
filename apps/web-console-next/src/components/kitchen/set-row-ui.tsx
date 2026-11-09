"use client";

import * as React from "react";
import { Check, History } from "lucide-react";
import type { KitchenItem, KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { useItemMoves, useLogUse, useMembersOf } from "./pantry-data";
import { useMemberNames } from "./people-data";
import { faceColor, faceOrder, toggleFace } from "./faces";
import { memberInitials, memberLabel, type MemberNames } from "./members";
import { orderConsumers } from "./item-use";
import { usePantryDrafts, saveDraft } from "@/lib/pantry-device";
import type { PantryRow } from "./pantry-list";
import { useAskToUse, useCancelAsk } from "./ask-data";
import { askButtonText, type AskStatus } from "./ask-before-use";
import { ASK_BUTTON, AskLockIcon, AskWaitBox } from "./ask-ui";
import { draftOf, lastLine, setConsumers, setCostLine } from "./pantry-set";
import { draftPick, pickStart, pickWrite, type AmountPick } from "./amount-picker";
import { AmountPicker } from "./amount-picker-ui";

/** Faces the set row shows before "+N" (which opens the sheet's full row). */
const SET_FACES = 4;

/**
 * The row's amount and people as the device keeps them (the open row, the
 * sheet and the item page share them): the amount picked with unit chips
 * (PN-11), starting at the suggestion, and the people.
 */
export function useSetState(row: Pick<PantryRow, "ladder">, item: ReachableItem | KitchenItem, roster: readonly string[] | null, meId: string | null) {
  const drafts = usePantryDrafts();
  const draft = drafts[item.id] ?? null;
  const suggestion = row.ladder.suggestion;
  const start = pickStart(item, suggestion);
  const pick: AmountPick | null = draftPick(item, draft?.pick) ?? start;
  const consumers = orderConsumers(
    setConsumers({ item, draft: draft?.consumers ?? null, suggestion, roster, meId }),
    roster ?? [],
    meId,
  );
  return {
    pick,
    start,
    /** The suggestion's reason ("Morning usual"), shown while the amount is where it started. */
    why: suggestion?.why ?? null,
    consumers,
    /** What the pick logs: its amount, its words and its measure. */
    write: pick ? pickWrite(item, pick) : null,
    /** Set the amount (the people stay). */
    setPick: (next: AmountPick) => saveDraft(item.id, draftOf(next, draft?.consumers ?? null, new Date())),
    /** Set the people (the amount stays). */
    people: (next: readonly string[]) => saveDraft(item.id, draftOf(draft?.pick ? pick : null, next, new Date())),
    /** Logged: forget it. */
    clear: () => saveDraft(item.id, null),
  };
}

/**
 * The open row (design §1.1, "the set row"): Last; the amount with unit
 * chips (PN-11's `AmountPicker`), from the suggestion with its reason under
 * it ("Morning usual", then "Changed", "Typed" or "The rest"); for a group's item, the
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
  const { pick, write, consumers } = set;
  if (!pick || !write) return null;
  const asking = row.variant === "ask" && askName !== null && row.ref.kind === "group";

  const personal = item.pantry.kind === "personal";
  const last = lastLine({ moves: moves.data, usual, item, meId: me, names, now: new Date() });
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
        ...write,
        consumers,
        idempotencyKey: crypto.randomUUID(),
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
      ...write,
      consumers,
      idempotencyKey: crypto.randomUUID(),
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

      <AmountPicker item={item} name={row.name} pick={pick} start={set.start} why={set.why} onPick={set.setPick} />

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
          {ready ? setCostLine(item, write.qtyMilli, consumers) : "Pick who had it"}
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
