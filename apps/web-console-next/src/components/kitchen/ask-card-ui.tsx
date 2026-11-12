"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AskInboxItem, InboxResponse, KitchenAsk } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { Face } from "./faces-ui";
import { pillClass } from "./new-home-parts-ui";
import type { MemberNames } from "./members";
import { useAnswerAsk } from "./ask-data";
import {
  answerRefusal,
  approvalUndo,
  approveRequest,
  approvedText,
  approvingAsk,
  askCard,
  askCardsShown,
  canApprove,
  declineUndo,
  declinedText,
  withLeft,
  type AnsweredAsk,
} from "./ask-card";

/**
 * Home's ask cards (cookpool-pantry PN-9, design §8.3, the canvas's
 * AskApprove), at the top of To do: one per ask you answer, oldest first —
 * the asker's face, "Dev asks for 1 pinch of saffron", "For Dev and Anu ·
 * asked 2 min ago · 1.4 g left", "If you approve · ₹12 back to you", Always
 * let Dev use saffron (a switch), Decline and Approve. When less is left,
 * "Only 0.4 g left" and Approve what's left. An answer shows at once in the
 * card's place — "Approved · Dev and Anu owe you ₹12" or "Declined · Dev was
 * told" — with Undo, until you leave Home. `highlight` is the card the
 * push opened (`/home?ask=`).
 */
export function AskCards({
  asks,
  answered,
  onAnswered,
  meId,
  names,
  highlight,
}: {
  asks: readonly AskInboxItem[];
  /** The answers given on this page (Home keeps them, so a card stays after the inbox moves on). */
  answered: ReadonlyMap<string, AnsweredAsk>;
  onAnswered: (askId: string, a: AnsweredAsk | null) => void;
  meId: string | null;
  names: MemberNames;
  highlight: string | null;
}) {
  const shown = askCardsShown(asks, answered);
  const setOne = onAnswered;
  if (shown.length === 0) return null;
  return (
    <ul aria-label="Asks for you" className="flex flex-col gap-2">
      {shown.map((s) => (
        <li key={s.ask.id}>
          <AskCardView ask={s.ask} answered={s.answered} onAnswered={(a) => setOne(s.ask.id, a)} meId={meId} names={names} highlight={highlight === s.ask.id} />
        </li>
      ))}
    </ul>
  );
}

function AskCardView({
  ask: listed,
  answered,
  onAnswered,
  meId,
  names,
  highlight,
}: {
  ask: KitchenAsk;
  answered: AnsweredAsk | null;
  onAnswered: (a: AnsweredAsk | null) => void;
  meId: string | null;
  names: MemberNames;
  highlight: boolean;
}) {
  const qc = useQueryClient();
  const answer = useAnswerAsk();
  const [always, setAlways] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // What is left, when an approval said less is left than asked.
  const [left, setLeft] = React.useState<number | null>(null);
  const ask = left !== null ? withLeft(listed, left) : listed;
  const [now] = React.useState(() => new Date());
  const card = askCard(ask, { meId, names, now });

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

  const frame = cn(
    "scroll-mt-24 rounded-cp-card bg-card p-3.5 shadow-cp-card transition-shadow",
    answered ? "" : "border-[1.5px] border-cp-soon",
    highlight && "ring-4 ring-cp-soon/35",
  );

  if (answered) {
    const text = answered.answer === "approved" ? approvedText(answered.ask, { meId, names, always: answered.always }) : declinedText(answered.ask, { names });
    return (
      <article data-ask-id={listed.id} className={frame} aria-label={text.title}>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span role="status" className="text-[15px] font-medium">
              {text.title}
            </span>
            <span className="text-[13px] font-normal text-muted-foreground">{text.sub}</span>
          </span>
          <button
            type="button"
            onClick={() => void undo()}
            disabled={!answered.undo || busy}
            className={pillClass()}
          >
            Undo
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] font-normal text-cp-expired">
            {error}
          </p>
        ) : null}
      </article>
    );
  }

  const switchId = `ask-always-${listed.id}`;
  return (
    <article data-ask-id={listed.id} className={frame} aria-labelledby={`${switchId}-title`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Face subjectId={card.askerId} meId={meId} names={names} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id={`${switchId}-title`} className="text-base font-medium leading-snug">
              {card.title}
            </span>
            <span className="text-[13px] font-normal tabular-nums text-muted-foreground">{card.sub}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-[14px] bg-cp-owed-tint px-3 py-2.5 text-sm font-medium tabular-nums text-cp-owed">
          <span>{card.money.label}</span>
          <span>{card.money.value}</span>
        </div>
        {card.short ? <p className="px-1 text-sm font-medium text-cp-soon">{card.short}</p> : null}
        <button
          type="button"
          role="switch"
          aria-checked={always}
          onClick={() => setAlways((a) => !a)}
          className="flex min-h-12 items-center gap-3 rounded-xl px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 text-[15px] font-normal">{card.always}</span>
          <span aria-hidden className={cn("flex h-7 w-12 shrink-0 rounded-full p-[3px] transition-colors", always ? "justify-end bg-primary" : "justify-start bg-input")}>
            <span className="h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]" />
          </span>
        </button>
        {error ? (
          <p role="alert" className="px-1 text-[13px] font-normal text-cp-expired">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button
            type="button"
            onClick={() => void decline()}
            className={cn(pillClass(), "min-h-12 text-[15px]")}
          >
            Decline
          </button>
          <button
            type="button"
            disabled={!canApprove(ask)}
            onClick={() => void approve()}
            className={cn(pillClass("main"), "min-h-12 text-[15px]")}
          >
            {card.approve}
          </button>
        </div>
      </div>
    </article>
  );
}
