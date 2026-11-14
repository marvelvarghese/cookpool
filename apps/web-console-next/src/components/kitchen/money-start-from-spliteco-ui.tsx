"use client";

// Money-native MY-10: Start from Spliteco. One row on Add group opens a
// searchable list of the person's Spliteco groups (boards Money_AddGroupFrom
// and Money_PickSpliteco). Colours are the shared `look` tokens: render inside
// a LookScope (the Add group sheet is). Flat, 10-12px corners.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { look } from "@saas/spliteco-ui/look";
import { formatShort } from "@saas/spliteco-ui/money";
import { qk } from "@/lib/query";
import { appConfig } from "@/lib/app-config";
import { useSession } from "@/lib/session";
import {
  isAdded,
  peopleCount,
  pickableGroups,
  recencyOrder,
  searchGroups,
  startFromSpliteco,
  type StartFromSpliteco,
} from "./money-start-from-spliteco";

const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";

// ── data ────────────────────────────────────────────────────

const addedKey = (): string => `${appConfig().storagePrefix}.added-from-spliteco`;

function readAdded(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(addedKey()) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Remember that a Spliteco group became a Cookpool group, so the picker marks it Added from now on. */
export function recordAddedFromSpliteco(groupId: string): void {
  try {
    const next = [...new Set([...readAdded(), groupId])];
    window.localStorage.setItem(addedKey(), JSON.stringify(next));
  } catch {
    /* a hint only: the row just stays pickable */
  }
}

/** The person's Spliteco groups, newest activity first, and which are already added. */
export function useSplitecoGroupsForPicker(enabled = true) {
  const { client } = useSession();
  const groups = useQuery({
    queryKey: qk.moneyGroups(),
    queryFn: async () => (await client.spliteco.groups()).groups,
    enabled,
  });
  const activity = useQuery({
    queryKey: ["money", "recent-activity"],
    queryFn: async () => recencyOrder((await client.spliteco.activity()).entries),
    enabled,
  });
  const [addedIds] = React.useState<string[]>(() => (typeof window === "undefined" ? [] : readAdded()));
  return {
    groups: pickableGroups(groups.data ?? []),
    recent: activity.data ?? [],
    addedIds,
    loading: groups.isLoading,
    error: groups.isError,
    refetch: groups.refetch,
  };
}

/** Reads a picked group's people and currencies and maps them to Add group's fields. */
export function usePickSplitecoGroup(meId: string | null) {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (group: SplitecoGroupSummary): Promise<StartFromSpliteco> => {
      const detail = await qc.fetchQuery({ queryKey: qk.moneyGroup(group.id), queryFn: () => client.spliteco.group(group.id) });
      return startFromSpliteco(detail, meId);
    },
    [client, qc, meId],
  );
}

// ── the row on Add group ────────────────────────────────────

/** The one row above Name. Once a group is picked it names it; tap again to change. */
export function StartFromSplitecoRow({ picked, onOpen }: { picked: { name: string; people: number } | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-row="start-from-spliteco"
      onClick={onOpen}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "0 14px", border: 0, borderRadius: 12, background: look.soft, color: look.softInk, fontFamily: FONT, fontSize: 15, fontWeight: 500, textAlign: "left", cursor: "pointer" }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {picked ? `From ${picked.name}` : "Start from Spliteco"}
      </span>
      {picked ? <span style={{ fontSize: 13, fontWeight: 400 }}>{peopleCount(picked.people)}</span> : null}
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

// ── the list ────────────────────────────────────────────────

function Row({ group, added, onPick }: { group: SplitecoGroupSummary; added: boolean; onPick: (g: SplitecoGroupSummary) => void }) {
  const bal = group.myBalanceMinor;
  const tone = bal > 0 ? look.get : bal < 0 ? look.owe : look.muted;
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      aria-disabled={added}
      disabled={added}
      data-group={group.id}
      data-added={added ? "true" : "false"}
      onClick={() => onPick(group)}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 64, padding: "10px 14px", border: 0, borderRadius: 12, background: look.surface, color: look.ink, fontFamily: FONT, textAlign: "left", cursor: added ? "default" : "pointer", opacity: added ? 0.6 : 1 }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</span>
        <span style={{ fontSize: 13, color: look.muted }}>{peopleCount(group.memberCount)}</span>
      </span>
      {added ? (
        <span data-added-tag="" style={{ padding: "4px 10px", borderRadius: 10, background: look.soft, color: look.softInk, fontSize: 13, fontWeight: 500 }}>Added</span>
      ) : (
        <span data-balance="" style={{ fontSize: 14, fontWeight: 500, color: tone }}>
          {bal === 0 ? "Settled" : formatShort(bal, group.currency)}
        </span>
      )}
    </button>
  );
}

export interface SplitecoGroupPickerProps {
  groups: readonly SplitecoGroupSummary[];
  /** Group ids, most recent activity first. */
  recent: readonly string[];
  addedIds: readonly string[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onPick: (group: SplitecoGroupSummary) => void;
  onClose: () => void;
}

/** The searchable list of the person's Spliteco groups; Added ones are shown and cannot be picked. */
export function SplitecoGroupPicker({ groups, recent, addedIds, loading, error, onRetry, onPick, onClose }: SplitecoGroupPickerProps) {
  const [query, setQuery] = React.useState("");
  const shown = searchGroups(groups, query, recent);
  return (
    <div role="dialog" aria-label="Spliteco groups" data-picker="" style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: FONT, color: look.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your Spliteco groups"
          aria-label="Search your Spliteco groups"
          style={{ flex: 1, minWidth: 0, height: 44, padding: "0 14px", border: 0, borderRadius: 12, background: look.surface, color: look.ink, fontFamily: FONT, fontSize: 16, outline: "none" }}
        />
        <button type="button" onClick={onClose} style={{ height: 44, padding: "0 14px", border: 0, borderRadius: 12, background: look.soft, color: look.softInk, fontFamily: FONT, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
      {error ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, color: look.owe, fontSize: 14 }}>
          <span style={{ flex: 1 }}>Couldn&apos;t load your Spliteco groups.</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} style={{ height: 36, padding: "0 12px", border: 0, borderRadius: 10, background: look.soft, color: look.softInk, fontFamily: FONT, fontSize: 14, cursor: "pointer" }}>Try again</button>
          ) : null}
        </div>
      ) : loading ? (
        <div aria-busy="true" style={{ color: look.muted, fontSize: 14 }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div data-empty="" style={{ color: look.muted, fontSize: 14, padding: "8px 2px" }}>{query.trim() ? "No group by that name." : "No Spliteco groups yet."}</div>
      ) : (
        <div role="listbox" aria-label="Spliteco groups" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map((g) => (
            <Row key={g.id} group={g} added={isAdded(g, addedIds)} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}
