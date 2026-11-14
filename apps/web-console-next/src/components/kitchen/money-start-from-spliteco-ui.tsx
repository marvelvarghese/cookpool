"use client";

// Money-native MY-10: Start from Spliteco. One row on Add group opens a
// searchable list of the person's Spliteco groups (boards Money_AddGroupFrom
// and Money_PickSpliteco). Colours are the shared `look` tokens: render inside
// a LookScope (the Add group sheet is). Flat, 10-12px corners.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { look } from "@saas/spliteco-ui/look";
import { qk } from "@/lib/query";
import { appConfig } from "@/lib/app-config";
import { FOCUS, SHEET, Card, Section, SheetTitleRow, chevronRight, divider, fieldStyle } from "./money-sheet-kit";
import { useSession } from "@/lib/session";
import {
  isAdded,
  pickerSubtitle,
  peopleCount,
  pickableGroups,
  recencyOrder,
  searchGroups,
  startFromSpliteco,
  type StartFromSpliteco,
} from "./money-start-from-spliteco";


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

/** The one row above Name (board Money_AddGroup / AddGroupFrom): 56px, surface, radius 16. Picked, it names the group and offers Change. */
export function StartFromSplitecoRow({ picked, onOpen }: { picked: { name: string; people: number } | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-row="start-from-spliteco"
      onClick={onOpen}
      className={FOCUS}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", height: SHEET.startRow, flex: "none", padding: "0 16px", border: 0, borderRadius: 16, background: look.surface, color: look.ink, fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxSizing: "border-box" }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 12, color: look.muted }}>Start from Spliteco</span>
        <span style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked ? picked.name : "Pick a group"}</span>
      </span>
      {picked ? (
        <span style={{ fontSize: 14, fontWeight: 500, color: look.primary }}>Change</span>
      ) : (
        <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}

// ── the list ────────────────────────────────────────────────

function Row({ group, added, first, onPick }: { group: SplitecoGroupSummary; added: boolean; first: boolean; onPick: (g: SplitecoGroupSummary) => void }) {
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
      className={`${FOCUS} focus-visible:ring-inset`}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", height: SHEET.groupRow, padding: "0 16px", border: 0, background: "transparent", color: look.ink, fontFamily: "inherit", textAlign: "left", cursor: added ? "default" : "pointer", opacity: added ? 0.6 : 1, boxSizing: "border-box", ...divider(first ? 0 : 1) }}
    >
      <span aria-hidden style={{ width: SHEET.avatar, height: SHEET.avatar, borderRadius: "50%", background: look.soft, color: look.softInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, flex: "none" }}>
        {group.name.slice(0, 1).toUpperCase()}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</span>
        <span data-subtitle="" style={{ fontSize: 13, color: look.muted }}>{added ? peopleCount(group.memberCount) : pickerSubtitle(group)}</span>
      </span>
      {added ? <span data-added-tag="" style={{ fontSize: 14, color: look.muted }}>Added</span> : chevronRight}
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

/**
 * The searchable list of the person's Spliteco groups (board Money_PickSpliteco),
 * inside the Add group sheet: Back, the title, a 48px search, Recent. Added ones
 * are shown, muted, and cannot be picked.
 */
export function SplitecoGroupPicker({ groups, recent, addedIds, loading, error, onRetry, onPick, onClose }: SplitecoGroupPickerProps) {
  const [query, setQuery] = React.useState("");
  const shown = searchGroups(groups, query, recent);
  const searching = query.trim() !== "";
  const recentSet = new Set(recent);
  const recents = searching ? [] : shown.filter((g) => recentSet.has(g.id));
  const others = searching ? shown : shown.filter((g) => !recentSet.has(g.id));
  const list = (items: SplitecoGroupSummary[]) => (
    <Card role="listbox" aria-label="Spliteco groups">
      {items.map((g, i) => (
        <Row key={g.id} group={g} added={isAdded(g, addedIds)} first={i === 0} onPick={onPick} />
      ))}
    </Card>
  );
  return (
    <div data-picker="" style={{ display: "flex", flexDirection: "column", gap: SHEET.gap, minHeight: 0, flex: 1 }}>
      <SheetTitleRow title="Spliteco groups" onBack={onClose} />
      <label style={{ height: SHEET.search, flex: "none", borderRadius: 16, background: look.surface, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", boxSizing: "border-box" }} className="has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <svg aria-hidden width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${groups.length} groups`}
          aria-label="Search groups"
          style={{ ...fieldStyle, flex: 1, minWidth: 0, height: "100%", padding: 0, background: "transparent", outline: "none" }}
        />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: SHEET.gap, overflowY: "auto", minHeight: 0 }}>
        {error ? (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, color: look.owe, fontSize: 14 }}>
            <span style={{ flex: 1 }}>Couldn&apos;t load your Spliteco groups.</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className={FOCUS} style={{ minHeight: 44, padding: "0 14px", border: 0, borderRadius: 10, background: look.soft, color: look.softInk, fontFamily: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Try again</button>
            ) : null}
          </div>
        ) : loading ? (
          <div aria-busy="true" style={{ color: look.muted, fontSize: 14 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div data-empty="" style={{ color: look.muted, fontSize: 14, padding: "8px 2px" }}>{searching ? "No group by that name." : "No Spliteco groups yet."}</div>
        ) : (
          <>
            {recents.length > 0 ? <Section label="Recent">{list(recents)}</Section> : null}
            {others.length > 0 ? <Section label={searching ? undefined : "All groups"}>{list(others)}</Section> : null}
          </>
        )}
      </div>
    </div>
  );
}
