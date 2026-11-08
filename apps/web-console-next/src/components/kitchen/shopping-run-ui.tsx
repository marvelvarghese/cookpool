"use client";

import * as React from "react";
import Link from "./link";
import { Check, Lock, Minus, Plus, X } from "lucide-react";
import type { Pantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useProfile } from "./data";
import { KCard, K_BUTTON } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { useBack } from "./back-ui";
import { useMyRoles } from "./people-data";
import { usePantries } from "./pantry-data";
import { orderPantries, pantryChipLabel, pantryKey } from "./pantry";
import { localIsoDay } from "./item-form";
import { useRestock, useShoppingRun } from "./restock-data";
import {
  pantryPick,
  pricePick,
  runGroups,
  runLines,
  runSummary,
  runToast,
  stepPick,
  toggleTick,
  type RunLine,
  type RunPicks,
  type TickedLine,
} from "./shopping-run";

/**
 * The shopping run (cookpool-pantry PN-6, design §6.3, the canvas's
 * BuyAgain), `/pantry/run`: "Shopping run · Tick what you bought · change
 * what differs", then FINISHED, RUNNING LOW and YOU USUALLY BUY, each line
 * "Like last time: 2 L · ₹136 · Flat 4B" until ticked. Ticking (a 44 px
 * tick) opens the amount's − / +, the price (last time's for that amount,
 * editable) and the pantry (another you add to). Something new adds one
 * item. The footer — "Paid by you · each goes to its own pantry" and
 * **Add 3 · ₹449** — writes them in one purchase, with one Undo. Nothing is
 * ticked to start with.
 */
export function ShoppingRun() {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const restock = useRestock();
  const pantries = usePantries();
  const { roles } = useMyRoles();
  const recentSlugs = useRecentGroupSlugs();
  const shoppingRun = useShoppingRun();
  const close = useBack();
  const [now] = React.useState(() => new Date());
  const today = localIsoDay(now);
  const [picks, setPicks] = React.useState<RunPicks>({});
  const [choosing, setChoosing] = React.useState<string | null>(null);
  const idemKey = React.useRef(crypto.randomUUID());

  // Where a line can go: your own pantry, and groups where you are more than a viewer (Add item's rule).
  const writable = React.useMemo(
    () => orderPantries((pantries.data ?? []).filter((p) => p.kind === "personal" || roles.get(p.orgId) !== "viewer"), recentSlugs),
    [pantries.data, roles, recentSlugs],
  );
  const groups = React.useMemo(() => runGroups(restock.data, { now, today }), [restock.data, now, today]);
  const lines = React.useMemo(() => runLines(groups), [groups]);
  const summary = runSummary(lines, picks, { pantries: writable, today });
  const opened = new Map(summary.ticked.map((t) => [t.key, t] as const));

  const add = () => {
    if (!summary.request) return;
    const policyOf = (t: TickedLine) => {
      const p = writable.find((x) => pantryKey(x) === t.pantry);
      return p?.kind === "group" ? p.wastePolicy : null;
    };
    void shoppingRun({
      request: summary.request,
      where: summary.ticked.map((t) => ({ pantry: t.pantryRef, groupWastePolicy: policyOf(t) })),
      title: runToast(summary),
      meId,
      today,
      idempotencyKey: idemKey.current,
    });
    idemKey.current = crypto.randomUUID();
    setPicks({});
    close();
  };

  const loading = restock.loading || (!restock.data && !restock.error);
  return (
    <div className="space-y-3.5 pb-4 min-[900px]:max-w-[640px]">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-foreground/80 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-2xl font-extrabold leading-tight tracking-[-0.02em]">Shopping run</h1>
          <span className="text-[13px] font-bold text-muted-foreground">Tick what you bought · change what differs</span>
        </span>
      </header>

      {loading ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[136px] w-full rounded-[20px]" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-[136px] w-full rounded-[20px]" />
        </div>
      ) : restock.error ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load what to restock. {restock.error.message}</p>
          <Button variant="outline" className={K_BUTTON} onClick={restock.reload}>
            Try again
          </Button>
        </KCard>
      ) : groups.length === 0 ? (
        <KCard className="p-4">
          <p className="text-[15px] font-semibold text-muted-foreground">Nothing finished or running low</p>
        </KCard>
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`run-${g.id}`} className="flex flex-col gap-1.5">
            <h2 id={`run-${g.id}`} className="px-0.5 text-xs font-extrabold tracking-[0.06em] text-foreground/80">
              {g.title}
            </h2>
            <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[20px] border border-[#E3E6E0] bg-card">
              {g.lines.map((l) => (
                <RunLineView
                  key={l.key}
                  line={l}
                  ticked={opened.get(l.key) ?? null}
                  choosing={choosing === l.key}
                  pantries={writable}
                  onTick={() => {
                    setPicks((p) => toggleTick(p, l));
                    if (choosing === l.key) setChoosing(null);
                  }}
                  onStep={(delta) => setPicks((p) => stepPick(p, l, delta))}
                  onPrice={(text) => setPicks((p) => pricePick(p, l.key, text))}
                  onChoose={() => setChoosing((c) => (c === l.key ? null : l.key))}
                  onPantry={(key) => {
                    setPicks((p) => pantryPick(p, l.key, key, writable));
                    setChoosing(null);
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <Link
        href="/pantry/new"
        className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#9AA39D] text-[15px] font-extrabold text-foreground/80 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
        Something new
      </Link>

      {/* The one main button, in thumb reach (SM-15), above the tab bar. */}
      <div
        data-toast-above=""
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 -mx-4 flex flex-col gap-2 bg-gradient-to-t from-background from-[78%] to-transparent px-4 pb-1 pt-3 min-[900px]:static min-[900px]:mx-0 min-[900px]:max-w-sm min-[900px]:bg-none min-[900px]:px-0"
      >
        <p className="text-center text-[13px] font-bold text-foreground/80">{summary.problem ?? "Paid by you · each goes to its own pantry"}</p>
        <Button
          type="button"
          onClick={add}
          disabled={!summary.ready}
          className={cn(MAIN_BUTTON, summary.count === 0 && "bg-[#ECEEE9] text-muted-foreground disabled:opacity-100", "shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none")}
        >
          <MainButtonLabel title={summary.label} />
        </Button>
      </div>
    </div>
  );
}

function RunLineView({
  line,
  ticked,
  choosing,
  pantries,
  onTick,
  onStep,
  onPrice,
  onChoose,
  onPantry,
}: {
  line: RunLine;
  ticked: TickedLine | null;
  choosing: boolean;
  pantries: readonly Pantry[];
  onTick: () => void;
  onStep: (delta: 1 | -1) => void;
  onPrice: (text: string) => void;
  onChoose: () => void;
  onPantry: (key: string) => void;
}) {
  const on = ticked !== null;
  return (
    <li className={cn(on && "bg-[#FBFCFA]")}>
      <div className="flex min-h-16 items-center gap-2.5 py-2 pl-2 pr-3">
        {line.tickable ? (
          <button
            type="button"
            aria-pressed={on}
            aria-label={`${on ? "Untick" : "Tick"} ${line.name}`}
            onClick={onTick}
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border-[1.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary text-primary-foreground" : "border-[#C9CFC6] bg-card text-[#C9CFC6] hover:bg-accent",
            )}
          >
            <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden />
          </button>
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border-[1.5px] border-dashed border-[#D5DAD2] text-muted-foreground" aria-hidden>
            <Lock className="h-4 w-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-base font-extrabold", !line.tickable && "text-muted-foreground")}>{line.name}</span>
          <span className="truncate text-xs font-semibold text-muted-foreground">{on ? line.why : (line.locked ?? line.like)}</span>
        </span>
        {ticked ? <span className="shrink-0 text-[15px] font-extrabold tabular-nums">{ticked.priceMinor !== null ? `${ticked.prefix}${ticked.priceText}` : ""}</span> : null}
      </div>
      {ticked ? (
        <div className="flex flex-wrap items-center gap-2 pb-3 pl-[62px] pr-3">
          <button type="button" aria-label={`Less ${line.name}`} disabled={!ticked.canLess} onClick={() => onStep(-1)} className={STEPPER}>
            <Minus className="h-5 w-5" aria-hidden />
          </button>
          <span role="status" className="min-w-16 text-center text-[15px] font-extrabold tabular-nums">
            {ticked.step.words}
          </span>
          <button type="button" aria-label={`More ${line.name}`} disabled={!ticked.canMore} onClick={() => onStep(1)} className={STEPPER}>
            <Plus className="h-5 w-5" aria-hidden />
          </button>
          <label
            className={cn(
              "flex min-h-11 items-center gap-1 rounded-xl border px-2.5 text-[15px] font-extrabold focus-within:ring-2 focus-within:ring-ring",
              ticked.priceMinor === null ? "border-destructive" : "border-[#C9CFC6]",
            )}
          >
            <span aria-hidden>{ticked.prefix}</span>
            <input
              type="text"
              inputMode="decimal"
              value={ticked.priceText}
              onChange={(e) => onPrice(e.target.value)}
              aria-label={`Price of ${line.name}`}
              aria-invalid={ticked.priceMinor === null}
              autoComplete="off"
              className="w-16 bg-transparent text-[15px] font-extrabold tabular-nums text-foreground outline-none"
            />
          </label>
          <button
            type="button"
            aria-expanded={choosing}
            aria-label={`${line.name} goes to ${ticked.pantryLabel} · change`}
            onClick={onChoose}
            className="min-h-11 min-w-11 rounded-full bg-[#E6EEF8] px-3 text-xs font-extrabold text-[#1D4F91] transition-colors hover:bg-[#D9E5F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ticked.pantryLabel}
          </button>
          {choosing ? (
            <div role="group" aria-label={`Where ${line.name} goes`} className="flex w-full flex-wrap gap-2 pt-1">
              {pantries.map((p) => {
                const key = pantryKey(p);
                const here = key === ticked.pantry;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={here}
                    onClick={() => onPantry(key)}
                    className={cn(
                      "min-h-11 rounded-full border px-3.5 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      here ? "border-foreground bg-foreground text-background" : "border-[#D5DAD2] bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    {pantryChipLabel(p)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const STEPPER =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#C9CFC6] bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
