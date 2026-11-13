"use client";

import * as React from "react";
import Link from "./link";
import { ChevronLeft, ChevronRight, Plus, ShoppingCart, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "./data";
import { KCard, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { RING } from "./new-home-parts-ui";
import { useBack } from "./back-ui";
import { useMemberNames, useMyRoles } from "./people-data";
import { useStaples } from "./kitchen-staples-data";
import { pantryName, stapleKey } from "./kitchen-staples";
import { useItemHistory } from "./from-before-data";
import { useFoods } from "./recipes-data";
import { localIsoDay } from "./item-form";
import { TickRow } from "./tick-row-ui";
import { TICK_EMPTY, type TickState } from "./tick-row";
import {
  LIST_RUN_HREF,
  addedToast,
  amountText,
  boxChange,
  doneBar,
  gotKey,
  gotLabel,
  listBox,
  listedNames,
  needCountText,
  needGroups,
  needSuggestions,
  toggleGot,
  type ListPantry,
  type NeedGroup,
  type NeedRow,
  type NeedSuggestion,
} from "./shopping-list";
import { useGot, useNeedActions } from "./shopping-list-data";

/**
 * The shopping list, `/pantry/list` (cookpool-revamp RV-22, the board
 * RvShopping): "Shopping list · 5", then **Add what we need…** — names bought
 * before and foods as you type, a new name to Mine or each group — then
 * each pantry's list: its Always have running low or out (the tag and its
 * dot) and what people added (who), each with the amount box (TickRow's, the
 * saved amount in grey, saved on the line when changed) and one tick for
 * got it, kept on this device. **Done shopping · 3 items** opens the run
 * with the ticked rows. A pushed screen: no tab bar. Pure parts in
 * shopping-list.ts.
 */
export function ShoppingListPage() {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  const staples = useStaples();
  const { roles } = useMyRoles();
  const close = useBack();
  const actions = useNeedActions();
  const [got, setGot] = useGot();
  const [boxes, setBoxes] = React.useState<Readonly<Record<string, TickState>>>({});
  const [q, setQ] = React.useState("");
  const deferred = React.useDeferredValue(q.trim());
  const history = useItemHistory(deferred, deferred.length > 0);
  const foods = useFoods(deferred);
  const [today] = React.useState(() => localIsoDay(new Date()));

  const canEdit = React.useCallback(
    (p: { owner: { kind: "personal" } | { kind: "group"; orgId: string } }) => p.owner.kind === "personal" || roles.get(p.owner.orgId) !== "viewer",
    [roles],
  );
  const groups = needGroups(staples.data, { meId, names, got, canEdit });
  const writable: ListPantry[] = (staples.data?.pantries ?? []).filter(canEdit).map((p) => ({ key: stapleKey(p.owner), pantry: p, label: pantryName(p.owner) }));
  const suggestions = needSuggestions(q, {
    history: history.data ?? [],
    foods: foods.data ?? [],
    pantries: writable,
    listed: listedNames(staples.data),
    today,
  });
  const rows = groups.flatMap((g) => g.rows);
  // Mid-shop (something already got), what is added counts as got too.
  const shopping = rows.some((r) => r.got);
  const bar = doneBar(rows.map((r) => ({ name: r.name, amount: listBox(r, boxes[r.key] ?? TICK_EMPTY).words, got: r.got })));

  const add = (s: NeedSuggestion) => {
    const p = writable.find((x) => x.key === s.pantryKey);
    if (!p) return;
    setQ("");
    const key = gotKey(p.key, "hand", s.name);
    if (shopping) setGot((g) => (g.includes(key) ? g : toggleGot(g, key)));
    void actions.add(p.pantry, { name: s.name, qtyMilli: s.qtyMilli, unit: s.unit }, addedToast(s.name, p.label, shopping));
  };

  return (
    <div className="space-y-5 pb-4 min-[900px]:max-w-[640px]">
      <header className="-ml-2 flex items-center gap-1.5">
        <button type="button" onClick={close} aria-label="Back to Kitchen" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-foreground", RING)}>
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden />
        </button>
        <h1 className={cn(K_TITLE, "min-w-0 flex-1")}>
          Shopping list <span className="font-normal text-muted-foreground">{needCountText(groups)}</span>
        </h1>
      </header>

      {writable.length > 0 ? (
        <div className="-mt-1.5 flex flex-col gap-2">
          <div className="flex min-h-[52px] items-center gap-2.5 rounded-[18px] bg-card pl-3.5 pr-1 shadow-cp-card focus-within:ring-2 focus-within:ring-ring">
            <Plus className="h-5 w-5 shrink-0 text-cp-accent-text" strokeWidth={2.4} aria-hidden />
            <label htmlFor="list-add" className="sr-only">
              Add what we need to the list
            </label>
            <input
              id="list-add"
              type="text"
              autoComplete="off"
              enterKeyHint="done"
              maxLength={60}
              value={q}
              placeholder="Add what we need…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && suggestions[0]) {
                  e.preventDefault();
                  add(suggestions[0]);
                }
                if (e.key === "Escape") setQ("");
              }}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-base font-normal text-foreground outline-none placeholder:text-muted-foreground"
            />
            {q.trim() ? (
              <button type="button" aria-label="Clear" onClick={() => setQ("")} className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-muted-foreground", RING)}>
                <X className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
              </button>
            ) : null}
          </div>
          {q.trim() && suggestions.length > 0 ? (
            <ul aria-label="Suggestions" className={K_ROWS}>
              {suggestions.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-label={s.label}
                    onClick={() => add(s)}
                    className={cn("flex min-h-[60px] w-full items-center gap-2.5 py-2 pl-3.5 pr-3 text-left", RING, "focus-visible:ring-inset")}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-base font-medium">{s.key.startsWith("n:") ? `“${s.name}”` : s.name}</span>
                      <span className="truncate text-[13px] font-normal text-muted-foreground">{s.fact}</span>
                    </span>
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cp-accent-tint text-cp-accent-text">
                      <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {staples.loading && !staples.data ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[136px] w-full rounded-cp-card" />
        </div>
      ) : staples.error && !staples.data ? (
        <KCard className="p-5">
          <p className="text-sm font-normal text-muted-foreground">Couldn&apos;t load the list. {staples.error.message}</p>
        </KCard>
      ) : groups.length === 0 ? (
        <KCard className="p-4">
          <p className="text-[15px] font-normal text-muted-foreground">Nothing on the list</p>
        </KCard>
      ) : (
        groups.map((g) => (
          <NeedSection
            key={g.key}
            group={g}
            boxes={boxes}
            onBox={(key, s) => setBoxes((b) => ({ ...b, [key]: s }))}
            onTick={(r) => setGot((x) => toggleGot(x, r.key))}
            onSave={(r, box) => {
              const change = boxChange(r, listBox(r, box));
              if (change) void actions.setAmount(g.pantry, r, change);
            }}
            onRemove={(r) => {
              const item = g.pantry.items.find((i) => i.id === r.id);
              if (item) void actions.remove(g.pantry, item);
            }}
          />
        ))
      )}

      {bar && !q.trim() ? (
        <div data-toast-above="" className="sticky bottom-[max(24px,var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem)))] z-30 min-[900px]:static min-[900px]:max-w-sm">
          <Link
            href={LIST_RUN_HREF}
            className={cn("flex min-h-[60px] w-full items-center gap-3 rounded-[18px] bg-primary px-[18px] text-primary-foreground shadow-cp-nav min-[900px]:shadow-none", RING)}
          >
            <ShoppingCart className="h-[22px] w-[22px] shrink-0" strokeWidth={2} aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[17px] font-medium">{bar.title}</span>
              <span className="truncate text-[13px] font-normal opacity-85">{bar.sub}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function NeedSection({
  group,
  boxes,
  onBox,
  onTick,
  onSave,
  onRemove,
}: {
  group: NeedGroup;
  boxes: Readonly<Record<string, TickState>>;
  onBox: (key: string, state: TickState) => void;
  onTick: (row: NeedRow) => void;
  onSave: (row: NeedRow, state: TickState) => void;
  onRemove: (row: NeedRow) => void;
}) {
  return (
    <section aria-label={`${group.title} shopping list`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={K_SECTION}>
          {group.title} {group.sub ? <span className="font-normal text-muted-foreground">{group.sub}</span> : null}
        </h2>
        <span className="text-[13px] font-normal text-muted-foreground">{group.done}</span>
      </div>
      <div className={K_ROWS}>
        {group.rows.map((r) => {
          const state = boxes[r.key] ?? TICK_EMPTY;
          const box = listBox(r, state);
          return (
            <TickRow
              key={r.key}
              id={r.id}
              name={r.name}
              meta={null}
              amount={group.canEdit ? box : null}
              fixed={group.canEdit ? null : (amountText(r.qtyMilli, r.unit) ?? box.words)}
              end={group.canEdit ? undefined : <span />}
              state={state}
              onState={(s) => onBox(r.key, s)}
              onUnit={(unitId) => onSave(r, { typed: "", unit: unitId })}
              onAmountBlur={() => onSave(r, state)}
              done={null}
              picked={r.got}
              onTick={() => onTick(r)}
              tickLabel={gotLabel}
              listColumns
              // KC-8 (the canvas's Shopping): the measure opens the Measure drawer, Take off the list at its foot.
              drawer={{ add: null }}
              chipsEnd={
                r.source === "hand" ? (
                  <button
                    type="button"
                    onClick={() => onRemove(r)}
                    className={cn("flex min-h-10 items-center gap-1 rounded-full px-3.5 text-sm font-medium text-muted-foreground hover:bg-cp-line", RING)}
                  >
                    <X className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                    Take off the list
                  </button>
                ) : null
              }
            >
              <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-normal text-muted-foreground">
                {r.always ? <span className="shrink-0 rounded-full bg-cp-accent-tint px-[7px] py-px text-xs font-medium text-cp-accent-text">Always have</span> : null}
                {r.dot ? <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", r.dot === "out" ? "bg-cp-expired" : "bg-cp-soon")} /> : null}
                <span className="truncate">{r.fact}</span>
              </span>
            </TickRow>
          );
        })}
      </div>
    </section>
  );
}
