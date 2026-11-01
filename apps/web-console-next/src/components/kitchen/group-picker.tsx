"use client";

import * as React from "react";
import { Check, ChevronDown, Layers, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { filterGroups, sortGroups, type GroupLike } from "./groups";
import { CLOSE_44, GroupAvatar, K_INPUT } from "./kit";
import { ALL_GROUPS } from "./settle";

/**
 * Choosing a group (CP-8), the design's one control for it: a search field
 * over the person's groups, recent ones first (no per-group tabs). Optionally
 * offers "All groups" at the top. `GroupPickerList` is the list itself (the
 * Add sheet shows it inline); `GroupPickerButton` opens it in a dialog.
 */
export function GroupPickerList<T extends GroupLike>({
  groups,
  value,
  onPick,
  allGroups = false,
  autoFocus = false,
  idPrefix,
}: {
  groups: readonly T[];
  /** The chosen slug, or ALL_GROUPS. */
  value?: string | null;
  onPick: (slug: string) => void;
  allGroups?: boolean;
  autoFocus?: boolean;
  idPrefix: string;
}) {
  const recentSlugs = useRecentGroupSlugs();
  const [query, setQuery] = React.useState("");
  const shown = React.useMemo(
    () => sortGroups(filterGroups(groups, query), "recent", recentSlugs),
    [groups, query, recentSlugs],
  );
  const showAll = allGroups && !query.trim();

  return (
    <div className="space-y-3">
      {groups.length > 4 || allGroups ? (
        <div className="relative">
          <label htmlFor={`${idPrefix}-search`} className="sr-only">
            Search groups
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={`${idPrefix}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups"
            autoComplete="off"
            autoFocus={autoFocus}
            className={cn(K_INPUT, "bg-card pl-11")}
          />
        </div>
      ) : null}
      <ul className="divide-y overflow-hidden rounded-[18px] border bg-card" aria-label="Groups">
        {showAll ? (
          <li>
            <PickRow selected={value === ALL_GROUPS} onClick={() => onPick(ALL_GROUPS)}>
              <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground">
                <Layers className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">All groups</span>
            </PickRow>
          </li>
        ) : null}
        {shown.map((g) => (
          <li key={g.id}>
            <PickRow selected={value === g.slug} onClick={() => onPick(g.slug)}>
              <GroupAvatar name={g.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{g.name}</span>
            </PickRow>
          </li>
        ))}
        {shown.length === 0 && !showAll ? (
          <li className="px-4 py-5 text-center text-sm text-muted-foreground">No groups match &ldquo;{query.trim()}&rdquo;</li>
        ) : null}
      </ul>
    </div>
  );
}

function PickRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-accent",
      )}
    >
      {children}
      {selected ? <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden /> : null}
    </button>
  );
}

/** The picker behind a button that names the current choice. */
export function GroupPickerButton<T extends GroupLike>({
  groups,
  value,
  onChange,
  allGroups = false,
  label,
}: {
  groups: readonly T[];
  value: string;
  onChange: (slug: string) => void;
  allGroups?: boolean;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current = groups.find((g) => g.slug === value) ?? null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-input bg-card px-4 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {current ? (
          <GroupAvatar name={current.name} size="sm" />
        ) : (
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground">
            <Layers className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">{label}</span>
          <span className="block truncate text-[15px] font-bold">{current ? current.name : "All groups"}</span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[22px] sm:max-w-md", CLOSE_44)}>
          <DialogHeader>
            <DialogTitle className="pr-10 text-xl font-extrabold">{label}</DialogTitle>
            <DialogDescription>Your groups, the ones you opened last first.</DialogDescription>
          </DialogHeader>
          <GroupPickerList
            groups={groups}
            value={value}
            allGroups={allGroups}
            idPrefix="group-picker"
            onPick={(slug) => {
              onChange(slug);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
