"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { filterGroups, sortGroups, type GroupLike } from "./groups";
import { GroupAvatar, K_INPUT } from "./kit";

/**
 * Choosing a group (CP-8), the design's one control for it: a search field
 * over the person's groups (past four), recent ones first (no per-group
 * tabs). The Add sheet shows it inline. (Settle up's "All groups" picker is
 * gone since SM-11: People shows every group, or the one a group's Settle up
 * opened it on.)
 */
export function GroupPickerList<T extends GroupLike>({
  groups,
  value,
  onPick,
  autoFocus = false,
  idPrefix,
}: {
  groups: readonly T[];
  /** The chosen slug. */
  value?: string | null;
  onPick: (slug: string) => void;
  autoFocus?: boolean;
  idPrefix: string;
}) {
  const recentSlugs = useRecentGroupSlugs();
  const [query, setQuery] = React.useState("");
  const shown = React.useMemo(
    () => sortGroups(filterGroups(groups, query), "recent", recentSlugs),
    [groups, query, recentSlugs],
  );

  return (
    <div className="space-y-3">
      {groups.length > 4 ? (
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
        {shown.map((g) => (
          <li key={g.id}>
            <PickRow selected={value === g.slug} onClick={() => onPick(g.slug)}>
              <GroupAvatar name={g.name} id={g.id} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{g.name}</span>
            </PickRow>
          </li>
        ))}
        {shown.length === 0 ? (
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
