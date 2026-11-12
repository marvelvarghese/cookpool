"use client";

import * as React from "react";
import type { InboxResponse, KitchenAsk, SplitReminderInboxItem } from "@saas/contracts/kitchen";
import type { AsyncState } from "@/lib/query";
import { cn } from "@/lib/cn";
import { KCard, K_ROWS, SectionHeading } from "./kit";
import type { MemberNames } from "./members";
import { ItemActionsSheet, type ItemMenuTarget } from "./item-actions-ui";
import { RowsSkeleton, SeeAllButton, pillClass } from "./new-home-parts-ui";
import { firstThree } from "./new-home-look";
import { askCardsShown, type AnsweredAsk } from "./ask-card";
import { AskRow } from "./ask-card-ui";
import { useAsks } from "./ask-data";
import { splitReminders, withoutJustMeFinalize } from "./cooked";
import { NEEDS_RANK, needsCount, needsTodos, orderNeeds, waitingMine, type NeedsTodo } from "./inbox-needs";
import { MineNeedsRow, ReminderNeedsRow, TodoNeedsRow, type NeedsDone } from "./inbox-needs-rows-ui";

/**
 * Home's Needs you (cookpool-revamp RV-15, the canvas's `HomeRevamp`): one
 * card of rows, every kind the inbox has, in the board's order — asks you
 * answer, open dishes, people to pay, food to use, your dishes to split
 * and the split reminders, your own asks that wait, then flags. "Needs you
 * · 3" counts what is left; a row done here stays, dimmed, with Undo, and
 * once all are done it reads "· all done". Three rows, then See all. With no
 * rows the section is gone. `asks` is Home's answered-asks state, which
 * also carries the push's `?ask=` highlight.
 */

type Entry =
  | { type: "ask"; key: string; rank: number; seq: number; ask: KitchenAsk; answered: AnsweredAsk | null }
  | { type: "todo"; key: string; rank: number; seq: number; todo: NeedsTodo }
  | { type: "reminder"; key: string; rank: number; seq: number; item: SplitReminderInboxItem }
  | { type: "mine"; key: string; rank: number; seq: number; ask: KitchenAsk };

/** A todo done here: what it says now, and the row as it was (it stays after the inbox drops it). */
interface DoneMark extends NeedsDone {
  entry: Extract<Entry, { type: "todo" }>;
}

export interface HomeAsksState {
  answered: ReadonlyMap<string, AnsweredAsk>;
  setAnswered: (id: string, a: AnsweredAsk | null) => void;
  highlight: string | null;
}

export function NeedsYou({
  inbox,
  meId,
  names,
  asks,
  className,
}: {
  inbox: AsyncState<InboxResponse>;
  meId: string | null;
  names: MemberNames;
  asks: HomeAsksState;
  className?: string;
}) {
  const [now] = React.useState(() => new Date());
  const mineAsks = useAsks();
  const [done, setDone] = React.useState<ReadonlyMap<string, DoneMark>>(new Map());
  // Your asks cancelled here: shown dimmed (a cancel has no Undo), kept after the asks move on.
  const [cancelled, setCancelled] = React.useState<ReadonlyMap<string, KitchenAsk>>(new Map());
  const [all, setAll] = React.useState(false);
  const [menu, setMenu] = React.useState<ItemMenuTarget | null>(null);

  const mark = React.useCallback((entry: Extract<Entry, { type: "todo" }>, d: NeedsDone | null) => {
    setDone((m) => {
      if (!d && !m.has(entry.key)) return m;
      const next = new Map(m);
      if (d) next.set(entry.key, { ...d, entry });
      else next.delete(entry.key);
      return next;
    });
  }, []);
  const markCancelled = React.useCallback((ask: KitchenAsk, on: boolean) => {
    setCancelled((m) => {
      const next = new Map(m);
      if (on) next.set(ask.id, ask);
      else next.delete(ask.id);
      return next;
    });
  }, []);

  const data = inbox.data;
  const entries = React.useMemo((): Entry[] => {
    if (!data) return [];
    const out: Entry[] = [];
    askCardsShown(data.asks ?? [], asks.answered).forEach((s, i) =>
      out.push({ type: "ask", key: `ask:${s.ask.id}`, rank: NEEDS_RANK.ask, seq: i, ask: s.ask, answered: s.answered }),
    );
    const live = new Set<string>();
    // No just-me "Finalize" (cookpool-community CM-9): it posts nothing, and splitting it is the reminder's.
    needsTodos(withoutJustMeFinalize(data).items, { meId, names, now }).forEach((todo, i) => {
      live.add(todo.key);
      out.push({ type: "todo", key: todo.key, rank: NEEDS_RANK[todo.kind], seq: i, todo });
    });
    for (const [key, d] of done) if (!live.has(key)) out.push(d.entry);
    splitReminders(data).forEach((item, i) => out.push({ type: "reminder", key: `reminder:${item.dish.id}`, rank: NEEDS_RANK.split, seq: 1000 + i, item }));
    const waiting = waitingMine(mineAsks.data?.mine);
    const ids = new Set(waiting.map((a) => a.id));
    [...waiting, ...[...cancelled.values()].filter((a) => !ids.has(a.id))].forEach((ask, i) =>
      out.push({ type: "mine", key: `mine:${ask.id}`, rank: NEEDS_RANK.mine, seq: i, ask }),
    );
    return orderNeeds(out);
  }, [data, asks.answered, meId, names, now, done, mineAsks.data, cancelled]);

  const isDone = (e: Entry) => (e.type === "ask" ? !!e.answered : e.type === "todo" ? done.has(e.key) : e.type === "mine" ? cancelled.has(e.ask.id) : false);
  const count = needsCount(entries.map((e) => ({ done: isDone(e) })));
  // The push's ask is always on screen, even past the first three.
  const target = asks.highlight ? entries.findIndex((e) => e.type === "ask" && e.ask.id === asks.highlight) : -1;
  const shown = firstThree(entries, all || target >= 3);

  if (inbox.loading) {
    return (
      <section aria-labelledby="home-todo" className={cn("space-y-2.5", className)}>
        <SectionHeading id="home-todo">Needs you</SectionHeading>
        <RowsSkeleton />
      </section>
    );
  }
  if (inbox.error || !data) {
    return (
      <section aria-labelledby="home-todo" className={cn("space-y-2.5", className)}>
        <SectionHeading id="home-todo">Needs you</SectionHeading>
        <KCard className="flex min-h-16 items-center justify-between gap-3 px-4 py-2">
          <p className="text-sm font-normal text-muted-foreground">Couldn&apos;t load what needs you.</p>
          <button type="button" className={pillClass()} onClick={inbox.reload}>
            Try again
          </button>
        </KCard>
      </section>
    );
  }
  // Nothing needs you: the section is gone (the board).
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="home-todo" className={cn("space-y-2.5", className)}>
      <SectionHeading id="home-todo" count={count}>
        Needs you
      </SectionHeading>
      <div className={K_ROWS}>
        <ul className="divide-y divide-cp-line">
          {shown.rows.map((e) => (
            <li key={e.key}>
              {e.type === "ask" ? (
                <AskRow ask={e.ask} answered={e.answered} onAnswered={(a) => asks.setAnswered(e.ask.id, a)} meId={meId} names={names} highlight={asks.highlight === e.ask.id} />
              ) : e.type === "todo" ? (
                <TodoNeedsRow
                  todo={e.todo}
                  done={done.get(e.key) ?? null}
                  meId={meId}
                  names={names}
                  onDone={(d) => mark(e, d)}
                  onUndone={() => mark(e, null)}
                  onMenu={setMenu}
                />
              ) : e.type === "reminder" ? (
                <ReminderNeedsRow item={e.item} meId={meId} names={names} />
              ) : (
                <MineNeedsRow ask={e.ask} cancelled={cancelled.has(e.ask.id)} meId={meId} names={names} now={now} onCancelled={(on) => markCancelled(e.ask, on)} />
              )}
            </li>
          ))}
        </ul>
        {shown.more ? <SeeAllButton label={shown.label} all={all} onToggle={() => setAll((v) => !v)} /> : null}
      </div>
      <ItemActionsSheet target={menu} onClose={() => setMenu(null)} meId={meId} />
    </section>
  );
}
