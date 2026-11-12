"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { InboxResponse, KitchenAsk } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { pillClass } from "./new-home-parts-ui";
import type { MemberNames } from "./members";
import { useAnswerAsk } from "./ask-data";
import { answerRefusal, approvalUndo, approveRequest, approvingAsk, canApprove, declineUndo, withLeft, type AnsweredAsk } from "./ask-card";
import { askAnsweredMeta, askRowText } from "./inbox-needs";
import { NeedsBadge, NeedsRow } from "./inbox-row-ui";

/**
 * An ask you answer, as one of Home's Needs you rows (cookpool-pantry PN-9;
 * cookpool-revamp RV-15, the canvas's `HomeRevamp`): the asker's face, "Anu
 * asks for Milk" over "1 glass · ₹12 back to you", No and Allow, and under
 * it the switch "Always let Anu use milk". When less is left, "Only 0.4 g
 * left" and Allow what's left. An answer shows at once in the row's place —
 * dimmed, "Allowed · Anu owes you ₹12" or "Said no · Anu was told" — with
 * Undo, until you leave Home. `highlight` is the row the push opened
 * (`/home?ask=`).
 */
export function AskRow({
  ask: listed,
  answered,
  onAnswered,
  meId,
  names,
  highlight,
  className,
}: {
  ask: KitchenAsk;
  /** The answer given on this page (Home keeps it, so the row stays after the inbox moves on). */
  answered: AnsweredAsk | null;
  onAnswered: (a: AnsweredAsk | null) => void;
  meId: string | null;
  names: MemberNames;
  highlight: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const answer = useAnswerAsk();
  const [always, setAlways] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // What is left, when an approval said less is left than asked.
  const [left, setLeft] = React.useState<number | null>(null);
  const ask = left !== null ? withLeft(listed, left) : listed;
  const text = askRowText(ask, { meId, names });

  // Undo put it back to waiting: list it again at once (the inbox reads again too).
  const relist = (a: KitchenAsk) =>
    qc.setQueryData<InboxResponse>(qk.kitchenInbox(), (d) =>
      d && !(d.asks ?? []).some((x) => x.ask.id === a.id) ? { ...d, asks: [...(d.asks ?? []), { kind: "ask", ask: { ...a, state: "pending" } }] } : d,
    );

  const approve = async () => {
    setError(null);
    const wasAlways = always;
    onAnswered({ ask: approvingAsk(ask), answer: "approved", always: wasAlways, undo: null });
    const r = await answer.approve(ask, approveRequest(ask, { always: wasAlways }));
    if (r.ok) {
      onAnswered({ ask: r.data.ask, answer: "approved", always: wasAlways, undo: approvalUndo(ask.orgId, r.data) });
      return;
    }
    onAnswered(null);
    const why = answerRefusal(r.error, ask);
    if (why.qtyLeftMilli !== null) setLeft(why.qtyLeftMilli);
    setError(why.text);
  };
  const decline = async () => {
    setError(null);
    onAnswered({ ask, answer: "declined", always: false, undo: null });
    const r = await answer.decline(ask);
    if (r.ok) {
      onAnswered({ ask: r.data.ask, answer: "declined", always: false, undo: declineUndo(ask) });
      return;
    }
    onAnswered(null);
    setError(answerRefusal(r.error, ask).text);
  };
  const undo = async () => {
    if (!answered?.undo) return;
    setBusy(true);
    const r = await answer.undo(answered.undo);
    setBusy(false);
    if (r.ok) {
      relist(answered.ask);
      onAnswered(null);
      setAlways(false);
      return;
    }
    setError(r.error.reason === "already_reversed" ? "Already undone." : `Couldn't undo it. ${r.error.message}`);
  };

  return (
    <NeedsRow
      data-ask-id={listed.id}
      className={cn("scroll-mt-24 transition-shadow", highlight && "ring-4 ring-inset ring-cp-soon/35", className)}
      badge={<NeedsBadge faceId={listed.asker} meId={meId} names={names} />}
      title={text.title}
      kindLabel="Ask"
      meta={answered ? askAnsweredMeta(answered, { meId, names }) : text.meta}
      tone={text.tone}
      done={!!answered}
      end={
        answered ? (
          <button type="button" onClick={() => void undo()} disabled={!answered.undo || busy} className={pillClass("done")}>
            Undo<span className="sr-only">: {text.title}</span>
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void decline()} className={cn(pillClass("done"), "px-3")}>
              No<span className="sr-only">: {text.title}</span>
            </button>
            <button type="button" disabled={!canApprove(ask)} onClick={() => void approve()} className={pillClass()}>
              {text.allow}
              <span className="sr-only">: {text.title}</span>
            </button>
          </>
        )
      }
      below={
        <>
          {answered ? null : (
            <button
              type="button"
              role="switch"
              aria-checked={always}
              onClick={() => setAlways((a) => !a)}
              className="flex min-h-11 w-full items-center gap-3 pb-2 pl-[66px] pr-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-normal text-muted-foreground">{text.always}</span>
              <span aria-hidden className={cn("flex h-6 w-10 shrink-0 rounded-full p-[3px] transition-colors", always ? "justify-end bg-primary" : "justify-start bg-input")}>
                <span className="h-[18px] w-[18px] rounded-full bg-card shadow-cp-card" />
              </span>
            </button>
          )}
          {error ? (
            <p role="alert" className="pb-3 pl-[66px] pr-3.5 text-[13px] font-normal text-cp-expired">
              {error}
            </p>
          ) : null}
        </>
      }
    />
  );
}
