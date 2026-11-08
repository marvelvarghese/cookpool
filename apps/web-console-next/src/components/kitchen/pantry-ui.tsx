"use client";

import * as React from "react";
import Link from "./link";
import { cn } from "@/lib/cn";
import { GroupAvatar } from "./kit";
import { NoteLine } from "./item-note-ui";
import { Money } from "./ledger-ui";
import type { ShareLine } from "./item-use";
import type { BarTone, ItemRowView, PantryListRow, PantryOption, ExpiryChip } from "./pantry";
import { SwipeRow, type SwipeAction } from "./row-gestures-ui";

/**
 * The pantry screens' visual pieces (Cookpool CP-12): a pantry's badge, the
 * use-by chip, the remaining bar, an item as a phone row (SM-10: one line)
 * and as a desktop table. (The pantry picker and the desktop filter chips
 * went in SM-15: Pantry and Bought use one row of chips.) Colors come from
 * the `.cookpool` tokens; the chip says its date in words, so color is never
 * the only cue.
 */

const BADGE = "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-xs font-extrabold";

/** "Me" for your own pantry, "All" for every pantry, else the group's avatar. */
export function PantryBadge({ kind, label, badge, className }: { kind: PantryOption["kind"]; label: string; badge: string; className?: string }) {
  if (kind === "group") return <GroupAvatar name={label} size="sm" {...(className ? { className } : {})} />;
  return (
    <span
      aria-hidden
      className={cn(BADGE, kind === "all" ? "bg-foreground text-background" : "bg-cp-herb-tint text-primary", className)}
    >
      {badge}
    </span>
  );
}

const PILL: Record<ExpiryChip["tone"], string> = {
  soon: "bg-cp-soon-tint text-cp-soon",
  expired: "bg-cp-expired-tint text-cp-expired",
  later: "bg-muted text-muted-foreground",
};

/** The use-by chip: amber soon, red expired, grey later. */
export function UseByPill({ chip, className }: { chip: ExpiryChip; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold", PILL[chip.tone], className)}>
      {chip.tone === "expired" || chip.label.startsWith("Use by") ? null : <span className="sr-only">Use by: </span>}
      {chip.label}
    </span>
  );
}

// The bar's own fills: amber and grey a shade lighter than the chip's text, so
// the bar reads as a bar (the kitchen palette is light-only).
const BAR: Record<BarTone, string> = {
  ok: "bg-primary",
  soon: "bg-[#D99A00]",
  expired: "bg-[#B8BFB9]",
};

/** How much is left, as a bar. Decorative: the text beside it says the amount. */
export function StockBar({ percent, tone, className, thick = false }: { percent: number; tone: BarTone; className?: string; thick?: boolean }) {
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-full bg-border", thick ? "h-2.5" : "h-1.5", className)}>
      <div className={cn("h-full rounded-full", BAR[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * One item on the phone's list (SM-10, the canvas's "Simpler — Pantry"): its
 * name, what is left (never wrapped), one chip when it is due soon or past
 * its date and its pantry's chip on All — the row opens the item — and Use at
 * the end: your usual amount logged at once ("1 glass"), or Use, which opens
 * the Use screen with it chosen. Just added (SM-5), it is listed at once and
 * opens once the server has it. PW-8: swiping the row left does what Use
 * does (`swipe`), and holding it opens its menu (`onLongPress`); Use stays.
 * RC-3: its note, when the row carries one (the new frame), is a third line.
 */
export function PantryListRowView({
  row,
  onLog,
  swipe = null,
  onLongPress,
}: {
  row: PantryListRow;
  onLog: (() => void) | null;
  swipe?: SwipeAction | null;
  onLongPress?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-base font-extrabold leading-snug", row.struck && "text-muted-foreground line-through")}>{row.name}</span>
        {row.chip || row.pantry ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5">
            {row.chip ? <UseByPill chip={row.chip} /> : null}
            {row.pantry ? (
              <span className="min-w-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{row.pantry}</span>
            ) : null}
          </span>
        ) : null}
        {row.note ? <NoteLine note={row.note} /> : null}
      </span>
      <span className="shrink-0 whitespace-nowrap text-[15px] font-extrabold tabular-nums">
        <span className="sr-only">Left: </span>
        {row.left}
      </span>
    </>
  );
  const opens = "flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-1";
  const use = row.use;
  return (
    <SwipeRow
      action={row.pending ? null : swipe}
      onLongPress={row.pending ? undefined : onLongPress}
      aria-busy={row.pending || undefined}
      frontClassName="flex items-center"
    >
      {row.pending ? (
        <span className={cn(opens, "cursor-default opacity-70")}>{body}</span>
      ) : (
        <Link
          href={row.href}
          draggable={false}
          className={cn(opens, "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
        >
          {body}
        </Link>
      )}
      <span className="flex w-[84px] shrink-0 justify-end pr-3">
        {use?.kind === "log" && onLog ? (
          <button
            type="button"
            aria-label={use.label}
            onClick={onLog}
            className="h-11 max-w-full truncate rounded-[12px] border border-primary bg-accent px-2.5 text-[13px] font-extrabold text-primary transition-colors hover:bg-cp-herb-tint/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {use.words}
          </button>
        ) : use ? (
          <Link
            href={use.kind === "open" ? use.href : row.href}
            aria-label={use.label}
            className="grid h-11 place-items-center rounded-[12px] border border-input bg-card px-3 text-[13px] font-extrabold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Use
          </Link>
        ) : null}
      </span>
    </SwipeRow>
  );
}

/** Every item as one table, soonest use-by first (from 900px). */
export function ItemTable({ rows, showPantry }: { rows: readonly ItemRowView[]; showPantry: boolean }) {
  const th = "border-b px-4 py-3.5 text-left";
  return (
    <div className="overflow-x-auto rounded-[20px] border bg-card">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className={th}>
              Item
            </th>
            {showPantry ? (
              <th scope="col" className={th}>
                Pantry
              </th>
            ) : null}
            <th scope="col" className={cn(th, "w-52")}>
              Left
            </th>
            <th scope="col" className={th}>
              Price
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Worth
            </th>
            <th scope="col" className={th}>
              Paid by
            </th>
            <th scope="col" className={th}>
              Use by
            </th>
            <th scope="col" className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0">
              <td className="px-4 py-2.5" aria-busy={r.pending || undefined}>
                {r.pending ? (
                  <span className={cn("font-bold opacity-70", r.struck && "text-muted-foreground line-through")}>{r.name}</span>
                ) : (
                  <Link
                    href={r.href}
                    className={cn(
                      "rounded font-bold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      r.struck && "text-muted-foreground line-through",
                    )}
                  >
                    {r.name}
                  </Link>
                )}
                {r.note ? <NoteLine note={r.note} className="max-w-72" /> : null}
              </td>
              {showPantry ? (
                <td className="px-4 py-2.5">
                  <span className="inline-flex max-w-44 truncate whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
                    {/* The chips' word for your own (SM-15): "Me", as above the table. */}
                    {r.pantryKey === "personal" ? "Me" : r.pantryLabel}
                  </span>
                </td>
              ) : null}
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <StockBar percent={r.percent} tone={r.bar} className="min-w-12 flex-1" />
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">{r.leftOfBought}</span>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">{r.unitPrice}</td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums">{r.worth}</td>
              <td className="px-4 py-2.5">{r.paidBy}</td>
              <td className="px-4 py-2.5">
                {r.chip ? <UseByPill chip={r.chip} /> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-1.5 text-right">
                {r.canUse ? (
                  <Link
                    href={r.useHref}
                    aria-label={`Use some ${r.name}`}
                    className="inline-flex min-h-11 items-center rounded-[10px] border border-primary px-3.5 text-[13px] font-extrabold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Use
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Using an item (CP-12; who had it is the faces' row since SM-7) ─

/** Who owes whom for a use or waste: "You owe Anu ₹2.00" (orange), "Dev owes you" (blue), own shares grey. */
export function ShareList({ lines, currency, empty }: { lines: readonly ShareLine[]; currency: string; empty?: string | null }) {
  if (empty || lines.length === 0) {
    return empty ? <p className="rounded-[14px] bg-background px-3.5 py-3 text-sm text-muted-foreground">{empty}</p> : null;
  }
  return (
    <ul aria-label="Who owes what" className="space-y-1.5 rounded-[14px] bg-background px-3.5 py-3 text-sm">
      {lines.map((l) => (
        <li key={l.subjectId} className="flex items-baseline justify-between gap-3">
          <span className={cn("min-w-0", l.tone === "own" && "text-muted-foreground")}>{l.text}</span>
          <Money
            minor={l.amountMinor}
            currency={currency}
            className={cn(
              "shrink-0 font-bold",
              l.tone === "owe" && "font-extrabold text-cp-owe",
              l.tone === "owed" && "font-extrabold text-cp-owed",
              l.tone === "own" && "text-muted-foreground",
            )}
          />
        </li>
      ))}
    </ul>
  );
}
