"use client";

// Spliteco inside (money-inside MN-2, the canvas's "Money, calmer" B boards):
// the Money tab Cookpool and Tripeco both show — the same screens in
// Spliteco's Deep ocean, whatever the host's own look. A "← Cookpool" pill and
// the Spliteco mark on top; one total; Settle up and + Expense; the groups as
// chips and rows; a group's balance, the people you settle with (Remind), and
// its three latest rows. Reads go through the host's own API client; anything
// that writes money (settle, an expense) opens the Spliteco app itself.

import * as React from "react";
import type {
  SplitecoActivityResponse,
  SplitecoGroupResponse,
  SplitecoGroupsResponse,
  SplitecoReminderRequest,
} from "@saas/contracts/spliteco";
import { SPLITECO_INSIDE } from "./inside-look.js";
import { latestRows, moneyTabGroups, moneyTotals, peopleText, signedShort, toneOf, withYou, type MoneyTone } from "./money-tab.js";

export { SPLITECO_INSIDE };
const C = SPLITECO_INSIDE;

/** The reads the tab needs: the host's API client's `spliteco` part. */
export interface SplitecoMoneyApi {
  groups(): Promise<SplitecoGroupsResponse>;
  group(groupId: string): Promise<SplitecoGroupResponse>;
  groupActivity(groupId: string): Promise<SplitecoActivityResponse>;
  remind(body: SplitecoReminderRequest): Promise<unknown>;
}

/** Where the Spliteco app takes over: settling, adding an expense, the whole group. */
export type SplitecoOpen = { kind: "settle" | "expense" | "group"; groupId: string | null };

export interface SplitecoMoneyTabProps {
  api: SplitecoMoneyApi;
  /** "Cookpool", "Tripeco": the pill's words. */
  hostName: string;
  /** Where the pill goes back to (the host's home). */
  onBack: () => void;
  meId: string | null;
  /** Open the Spliteco app (the host signs in there its own way). */
  onOpen: (target: SplitecoOpen) => void;
  /** The group chosen from outside (`?group=`); the tab keeps its own choice after. */
  initialGroupId?: string | null;
}

type Load<T> = { data: T | null; error: string | null; loading: boolean };

function useRead<T>(read: (() => Promise<T>) | null, deps: React.DependencyList): Load<T> & { reload: () => void } {
  const [state, setState] = React.useState<Load<T>>({ data: null, error: null, loading: read !== null });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!read) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    read().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => live && setState({ data: null, error: e instanceof Error ? e.message : "Couldn't load", loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

const TONE: Record<MoneyTone, string> = { get: C.get, owe: C.owe, even: C.muted };

const btn = (primary: boolean): React.CSSProperties => ({
  height: 52,
  borderRadius: 18,
  border: 0,
  background: primary ? C.cobalt : C.card,
  color: primary ? C.white : C.ink,
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
});
const cardStyle: React.CSSProperties = { background: C.card, borderRadius: 22, overflow: "hidden" };

function Initial({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: C.tint, color: C.soft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.4), fontWeight: 500, flex: "none" }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function SplitecoMoneyTab({ api, hostName, onBack, meId, onOpen, initialGroupId = null }: SplitecoMoneyTabProps) {
  const groups = useRead(() => api.groups(), [api]);
  const [chosen, setChosen] = React.useState<string | null>(initialGroupId);
  const list = groups.data ? moneyTabGroups(groups.data.groups) : null;
  const group = chosen && list ? (list.find((g) => g.id === chosen) ?? null) : null;

  return (
    <div data-spliteco-inside="" style={{ background: C.ground, color: C.ink, minHeight: "100dvh", margin: "0 -16px", padding: "16px 16px 120px", display: "flex", flexDirection: "column", gap: 18, fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40 }}>
        <button type="button" onClick={onBack} style={{ height: 36, padding: "0 12px 0 8px", borderRadius: 999, border: 0, background: C.card, color: C.ink, display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
          <span aria-hidden style={{ color: C.muted }}>‹</span>
          {hostName}
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: C.gold }}>
          <span aria-hidden style={{ width: 18, height: 18, borderRadius: 6, background: C.gold, color: C.ground, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
            S
          </span>
          Spliteco
        </span>
      </div>

      {groups.error ? (
        <div style={{ ...cardStyle, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, fontSize: 14, color: C.muted }}>Couldn&apos;t load your money.</span>
          <button type="button" onClick={groups.reload} style={{ ...btn(false), height: 40, padding: "0 14px", background: C.tint }}>
            Try again
          </button>
        </div>
      ) : null}

      {list === null && !groups.error ? <div aria-hidden style={{ ...cardStyle, height: 220, opacity: 0.6 }} /> : null}

      {list !== null ? (
        <>
          {group ? <GroupBalance minor={group.myBalanceMinor} currency={group.currency} name={group.name} /> : <Totals groups={list} />}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" style={btn(true)} onClick={() => onOpen({ kind: "settle", groupId: group?.id ?? null })}>
              Settle up
            </button>
            <button type="button" style={btn(false)} onClick={() => onOpen({ kind: "expense", groupId: group?.id ?? null })}>
              + Expense
            </button>
          </div>
          {list.length > 0 ? (
            <div role="tablist" aria-label="Groups" style={{ display: "flex", gap: 8, overflowX: "auto", margin: "0 -16px", padding: "0 16px", scrollbarWidth: "none" }}>
              {[{ id: null as string | null, name: "All" }, ...list].map((g) => {
                const on = (g.id ?? null) === (group?.id ?? null);
                return (
                  <button
                    key={g.id ?? "all"}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setChosen(g.id)}
                    style={{ height: 36, padding: "0 14px", borderRadius: 999, border: 0, whiteSpace: "nowrap", fontSize: 14, fontWeight: 500, background: on ? C.cobalt : C.card, color: on ? C.white : C.ink, flex: "none", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          {group ? (
            <GroupDetail key={group.id} api={api} groupId={group.id} meId={meId} onOpen={onOpen} />
          ) : list.length === 0 ? (
            <div style={{ ...cardStyle, padding: 20, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 15 }}>No groups yet</span>
              <button type="button" style={{ ...btn(false), height: 40, padding: "0 14px", background: C.tint }} onClick={() => onOpen({ kind: "group", groupId: null })}>
                Start one in Spliteco
              </button>
            </div>
          ) : (
            <div style={cardStyle}>
              {list.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setChosen(g.id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 64, padding: "0 16px", border: 0, borderTop: i === 0 ? 0 : `1px solid ${C.line}`, background: "transparent", color: C.ink, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <Initial name={g.name} size={34} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                    <span style={{ fontSize: 13, color: C.muted }}>{peopleText(g.memberCount)}</span>
                  </span>
                  {g.myBalanceMinor === 0 ? (
                    <span style={{ fontSize: 14, color: C.muted }}>Settled</span>
                  ) : (
                    <span style={{ fontSize: 15, fontWeight: 500, color: TONE[toneOf(g.myBalanceMinor)] }}>{signedShort(g.myBalanceMinor, g.currency)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Totals({ groups }: { groups: Parameters<typeof moneyTotals>[0] }) {
  const [first, ...rest] = moneyTotals(groups);
  if (!first) return null;
  return (
    <section aria-label="Overall" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 4px 0" }}>
      <span style={{ fontSize: 14, color: C.muted }}>Overall</span>
      <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em", color: first.minor === 0 ? C.ink : first.minor > 0 ? C.gold : C.owe }}>{signedShort(first.minor, first.currency)}</span>
      <span style={{ fontSize: 14, color: C.muted }}>{first.words}</span>
      {rest.map((t) => (
        <span key={t.currency} style={{ fontSize: 14, color: TONE[toneOf(t.minor)] }}>
          {signedShort(t.minor, t.currency)}
        </span>
      ))}
    </section>
  );
}

function GroupBalance({ minor, currency, name }: { minor: number; currency: string; name: string }) {
  return (
    <section aria-label={`${name} balance`} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 4px 0" }}>
      <span style={{ fontSize: 30, fontWeight: 500, color: minor === 0 ? C.ink : TONE[toneOf(minor)] }}>{minor === 0 ? "Settled" : signedShort(minor, currency)}</span>
      <span style={{ fontSize: 14, color: C.muted }}>{minor > 0 ? `you get back in ${name}` : minor < 0 ? `you owe in ${name}` : `all square in ${name}`}</span>
    </section>
  );
}

function GroupDetail({ api, groupId, meId, onOpen }: { api: SplitecoMoneyApi; groupId: string; meId: string | null; onOpen: (t: SplitecoOpen) => void }) {
  const detail = useRead(() => api.group(groupId), [api, groupId]);
  const activity = useRead(() => api.groupActivity(groupId), [api, groupId]);
  const [reminded, setReminded] = React.useState<ReadonlySet<string>>(new Set());
  const now = React.useMemo(() => new Date(), []);
  const currency = detail.data?.group.currency ?? "INR";
  const rows = detail.data ? withYou(detail.data, meId, activity.data?.people) : null;
  const latest = activity.data ? latestRows(activity.data.entries, [...activity.data.people, ...(detail.data?.members ?? [])], meId, now) : null;
  const remind = (to: string) => {
    setReminded((s) => new Set(s).add(to));
    void api.remind({ to, groupId }).catch(() => setReminded((s) => {
      const n = new Set(s);
      n.delete(to);
      return n;
    }));
  };
  const small: React.CSSProperties = { height: 32, padding: "0 12px", borderRadius: 999, border: 0, background: C.tint, color: C.soft, fontSize: 13, fontWeight: 500, marginLeft: 8, cursor: "pointer", fontFamily: "inherit" };

  return (
    <>
      <div style={cardStyle}>
        {rows === null ? <div aria-hidden style={{ height: 120, opacity: 0.6 }} /> : null}
        {rows?.length === 0 ? <div style={{ padding: "18px 16px", fontSize: 15, color: C.muted }}>All settled with you</div> : null}
        {rows?.map((r, i) => (
          <div key={r.subjectId} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "0 16px", borderTop: i === 0 ? 0 : `1px solid ${C.line}` }}>
            <Initial name={r.name} size={34} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: TONE[toneOf(r.minor)] }}>{signedShort(r.minor, currency)}</span>
            {r.minor > 0 ? (
              <button type="button" style={small} disabled={reminded.has(r.subjectId)} onClick={() => remind(r.subjectId)}>
                {reminded.has(r.subjectId) ? "Sent" : "Remind"}
              </button>
            ) : (
              <button type="button" style={{ ...small, background: C.cobalt, color: C.white }} onClick={() => onOpen({ kind: "settle", groupId })}>
                Settle
              </button>
            )}
          </div>
        ))}
      </div>
      {latest && latest.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", padding: "0 4px" }}>
            <h2 style={{ margin: 0, flex: 1, fontSize: 15, fontWeight: 500 }}>Latest</h2>
            <button type="button" onClick={() => onOpen({ kind: "group", groupId })} style={{ border: 0, background: "transparent", color: C.soft, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
              All in Spliteco
            </button>
          </span>
          <div style={cardStyle}>
            {latest.map((l, i) => (
              <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "0 16px", borderTop: i === 0 ? 0 : `1px solid ${C.line}` }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</span>
                  <span style={{ fontSize: 13, color: C.muted }}>{l.sub}</span>
                </span>
                {l.minor !== 0 ? <span style={{ fontSize: 15, fontWeight: 500, color: TONE[toneOf(l.minor)] }}>{signedShort(l.minor, l.currency)}</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
