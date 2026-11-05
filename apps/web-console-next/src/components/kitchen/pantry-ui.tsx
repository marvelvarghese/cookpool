"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, Search, Utensils } from "lucide-react";
import type { Pantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { GroupAvatar, K_INPUT } from "./kit";
import { Money } from "./ledger-ui";
import type { ShareLine } from "./item-use";
import {
  pantryChoice,
  pantryPickerList,
  type BarTone,
  type FilterChip,
  type ItemFilter,
  type ItemRowView,
  type PantryOption,
  type ExpiryChip,
} from "./pantry";

/**
 * The pantry screens' visual pieces (Cookpool CP-12): a pantry's badge, the
 * use-by chip, the remaining bar, the searchable pantry picker (an inline
 * panel, recent first), an item as a phone row and as a desktop table, and
 * the filter chips. Colors come from the `.cookpool` tokens; the chip says
 * its date in words, so color is never the only cue.
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
 * Choosing a pantry: a button naming the choice that opens an inline panel
 * with a search field and the list — All pantries (optional), Personal, then
 * groups, the ones opened last first; past five groups, a search finds the
 * rest. No per-group tabs (design §7).
 */
export function PantryPicker({
  pantries,
  value,
  onChange,
  label,
  idPrefix,
  includeAll = false,
  meta = "stock",
  memberCounts,
  className,
}: {
  pantries: readonly Pantry[];
  value: string;
  onChange: (key: string) => void;
  label: string;
  idPrefix: string;
  includeAll?: boolean;
  meta?: "stock" | "who";
  memberCounts?: ReadonlyMap<string, number>;
  className?: string;
}) {
  const recentSlugs = useRecentGroupSlugs();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const list = React.useMemo(
    () => pantryPickerList(pantries, { query, recentSlugs, includeAll, meta, ...(memberCounts ? { memberCounts } : {}) }),
    [pantries, query, recentSlugs, includeAll, meta, memberCounts],
  );
  const current = pantryChoice(pantries, value, { meta, ...(memberCounts ? { memberCounts } : {}) });
  const currentMeta = meta === "who" ? current.meta : null;
  const groupCount = pantries.filter((p) => p.kind === "group").length;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) buttonRef.current?.focus();
  };
  const pick = (key: string) => {
    onChange(key);
    close(true);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${idPrefix}-panel`}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-input bg-card px-3.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PantryBadge kind={current.kind} label={current.label} badge={current.badge} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
          <span className="block truncate text-base font-extrabold">{current.label}</span>
          {currentMeta ? <span className="block truncate text-xs text-muted-foreground">{currentMeta}</span> : null}
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <div
          id={`${idPrefix}-panel`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close(true);
            }
          }}
          className="space-y-1.5 rounded-[18px] border border-input bg-card p-2.5 shadow-[0_12px_32px_rgba(23,32,27,0.14)]"
        >
          {groupCount > 0 ? (
            <div className="relative">
              <label htmlFor={`${idPrefix}-search`} className="sr-only">
                Search pantries
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id={`${idPrefix}-search`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${groupCount} ${groupCount === 1 ? "group" : "groups"}`}
                autoComplete="off"
                autoFocus
                className={cn(K_INPUT, "border-transparent bg-background pl-10")}
              />
            </div>
          ) : null}
          {list.heading ? <p className="px-2 pt-1.5 text-xs font-bold text-muted-foreground">{list.heading}</p> : null}
          <ul aria-label="Pantries" className="max-h-[360px] overflow-y-auto">
            {list.options.map((o) => {
              const selected = o.key === value;
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pick(o.key)}
                    className={cn(
                      "flex min-h-[54px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-accent",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selected && "bg-accent",
                    )}
                  >
                    <PantryBadge kind={o.kind} label={o.label} badge={o.badge} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{o.label}</span>
                      {o.meta ? <span className="block truncate text-xs text-muted-foreground">{o.meta}</span> : null}
                    </span>
                    {selected ? <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {list.options.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No pantry matches &ldquo;{query.trim()}&rdquo;.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A row's body while its item is not on the server yet: the same look, nothing to open. */
function PendingRow({ className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <span className={cn(className, "block cursor-default opacity-70 hover:bg-transparent")}>{children}</span>;
}

/** One item on a phone: name, how much is left and who paid, the chip, price per unit, the bar, its worth — and Use on the right edge. */
export function ItemCard({ row }: { row: ItemRowView }) {
  // Just added (SM-5): shown at once, opened once the server has it.
  const Opens = row.pending ? PendingRow : Link;
  return (
    <li className="flex items-stretch overflow-hidden rounded-2xl border bg-card" aria-busy={row.pending || undefined}>
      <Opens
        href={row.href}
        className="min-w-0 flex-1 space-y-2 py-3 pl-3.5 pr-2 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex items-start justify-between gap-2.5">
          <span className="min-w-0">
            <span className={cn("block truncate text-[15px] font-bold", row.struck && "text-muted-foreground line-through")}>{row.name}</span>
            <span className="block truncate text-[13px] text-muted-foreground">{row.sub}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {row.chip ? <UseByPill chip={row.chip} /> : null}
            <span className="text-[13px] tabular-nums text-muted-foreground">{row.unitPrice}</span>
          </span>
        </span>
        <span className="flex items-center gap-2.5">
          <StockBar percent={row.percent} tone={row.bar} className="flex-1" />
          <span className="text-[13px] font-bold tabular-nums">
            <span className="sr-only">Worth </span>
            {row.worth}
          </span>
        </span>
      </Opens>
      {row.canUse ? (
        <Link
          href={row.useHref}
          aria-label={`Use some ${row.name}`}
          className="flex w-[62px] shrink-0 flex-col items-center justify-center gap-1 border-l bg-accent/70 text-[13px] font-extrabold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Utensils className="h-5 w-5" aria-hidden />
          Use
        </Link>
      ) : null}
    </li>
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
              </td>
              {showPantry ? (
                <td className="px-4 py-2.5">
                  <span className="inline-flex max-w-44 truncate whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
                    {r.pantryLabel}
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

/** All items · Use soon · N (· Expired · N). */
export function FilterChips({ chips, value, onChange }: { chips: readonly FilterChip[]; value: ItemFilter; onChange: (id: ItemFilter) => void }) {
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              on ? "border-foreground bg-foreground font-bold text-background" : "border-input bg-card font-semibold hover:bg-accent",
            )}
          >
            {c.label}
          </button>
        );
      })}
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
