"use client";

import * as React from "react";
import Link from "./link";
import { ChevronLeft, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "./data";
import { KCard, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { RING } from "./new-home-parts-ui";
import { useBack } from "./back-ui";
import { useMemberNames, useMyRoles } from "./people-data";
import { listGroups, type ListGroup } from "./kitchen-staples";
import { useStapleActions, useStaples } from "./kitchen-staples-data";

/**
 * The shopping list, `/pantry/list` (cookpool-revamp RV-21), kept plain on
 * purpose: the owner is redesigning it (amounts per line, what was bought
 * beyond the list, a receipt during the run; RV-22 builds it on these
 * routes). By pantry, each pantry's Always have running low or out (tagged,
 * with its dot and last price) and the lines added by hand (who added them,
 * their amount), each with ✕ for a hand-added line and + Add per pantry; Done
 * shopping opens the shopping run. A pushed screen: no tab bar.
 */
export function ShoppingListPage() {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  const staples = useStaples();
  const { roles } = useMyRoles();
  const close = useBack();
  const groups = listGroups(staples.data, { meId, names });
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div className="space-y-5 pb-4 min-[900px]:max-w-[640px]">
      <header className="-ml-2 flex items-center gap-1.5">
        <button type="button" onClick={close} aria-label="Back to Kitchen" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-foreground", RING)}>
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden />
        </button>
        <h1 className={cn(K_TITLE, "min-w-0 flex-1")}>
          Shopping list <span className="font-normal text-muted-foreground">· {count}</span>
        </h1>
      </header>

      {staples.loading && !staples.data ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[136px] w-full rounded-cp-card" />
        </div>
      ) : staples.error && !staples.data ? (
        <KCard className="p-5">
          <p className="text-sm font-normal text-muted-foreground">Couldn&apos;t load the list. {staples.error.message}</p>
        </KCard>
      ) : (
        groups.map((g) => <ListSection key={g.key} group={g} canAdd={g.pantry.owner.kind === "personal" || roles.get(g.pantry.owner.orgId) !== "viewer"} />)
      )}

      <div data-toast-above="" className="sticky bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem))] z-30 min-[900px]:static min-[900px]:max-w-sm">
        <Link href="/pantry/run" className={cn(MAIN_BUTTON, "flex items-center justify-center bg-primary text-primary-foreground shadow-cp-nav min-[900px]:shadow-none", RING)}>
          <MainButtonLabel title="Done shopping" />
        </Link>
      </div>
    </div>
  );
}

function ListSection({ group, canAdd }: { group: ListGroup; canAdd: boolean }) {
  const actions = useStapleActions();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const name = draft.trim();
    setDraft("");
    if (!name) {
      setAdding(false);
      return;
    }
    void actions.addToList(group.pantry, name.charAt(0).toUpperCase() + name.slice(1));
  };
  const inputId = `list-add-${group.key}`;
  return (
    <section aria-label={`${group.title} shopping list`} className="flex flex-col gap-2">
      <h2 className={K_SECTION}>
        {group.title} <span className="font-normal text-muted-foreground">{group.sub}</span>
      </h2>
      <div className={K_ROWS}>
        {group.rows.length > 0 ? (
          <ul className="divide-y divide-cp-line">
            {group.rows.map((r) => (
              <li key={r.id} className="flex min-h-16 items-center gap-2.5 py-2 pl-3.5 pr-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-base font-medium">{r.name}</span>
                    {r.source === "staple" ? <span className="shrink-0 rounded-full bg-cp-accent-tint px-2 py-0.5 text-xs font-medium text-cp-accent-text">Always have</span> : null}
                  </span>
                  <span className="flex items-center gap-1.5 text-[13px] font-normal text-muted-foreground">
                    {r.dot ? <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", r.dot === "out" ? "bg-cp-expired" : "bg-cp-soon")} /> : null}
                    {r.fact}
                  </span>
                </span>
                {r.source === "hand" && canAdd ? (
                  <button
                    type="button"
                    aria-label={`Take ${r.name} off the list`}
                    onClick={() => {
                      const item = group.pantry.items.find((i) => i.id === r.id);
                      if (item) void actions.removeFromList(group.pantry, item);
                    }}
                    className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cp-line text-muted-foreground", RING)}
                  >
                    <X className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3.5 py-4 text-[15px] font-normal text-muted-foreground">Nothing on the list</p>
        )}
        {canAdd ? (
          adding ? (
            <div className="flex min-h-16 items-center gap-2.5 border-t border-cp-line py-2 pl-3.5 pr-2.5">
              <label htmlFor={inputId} className="sr-only">
                Add to {group.title}
              </label>
              <input
                id={inputId}
                type="text"
                autoFocus
                maxLength={60}
                enterKeyHint="done"
                value={draft}
                placeholder="What do you need?"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                  if (e.key === "Escape") setAdding(false);
                }}
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-base font-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button type="button" aria-label={`Add to ${group.title}`} onClick={add} className={cn("grid h-11 w-12 shrink-0 place-items-center rounded-xl bg-cp-accent-tint text-cp-accent-text", RING)}>
                <Plus className="h-5 w-5" strokeWidth={2.2} aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={cn("flex min-h-12 w-full items-center justify-center gap-1.5 border-t border-cp-line text-sm font-medium text-cp-accent-text", RING, "focus-visible:ring-inset")}
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              Add
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}
