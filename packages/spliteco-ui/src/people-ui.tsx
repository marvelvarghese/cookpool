"use client";

// Money-native MY-5: the People side of Money and a person's page (boards
// Money_People and Person_Dev). Colours are tokens only (`look.*`, set by a
// LookScope from the `theme` prop); nothing here has a colour of its own.
// MY-4 owns the title and the Groups | People switch: People takes them as the
// `header` slot. The floating button (MY-3) and the settle box (MY-6) are
// `floatingButton` slots, empty here.

import * as React from "react";
import type { SplitecoBalancesResponse, SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { BOARD, BOARD_FONT } from "./board.js";
import { LookScope, look, type LookTheme } from "./look.js";
import {
  findPerson,
  personPage,
  personRow,
  searchPeople,
  type PersonAmount,
  type PersonRowView,
} from "./people.js";

/** The one read People and a person's page need: the host's `spliteco` client. */
export interface SplitecoPeopleApi {
  balances(): Promise<SplitecoBalancesResponse>;
}

const FONT = BOARD_FONT;
const B = BOARD;
const TONE = { get: look.get, owe: look.owe, even: look.muted } as const;

const softButton: React.CSSProperties = {
  height: 44,
  padding: "0 16px",
  borderRadius: 10,
  border: 0,
  background: look.soft,
  color: look.softInk,
  fontSize: 14,
  fontWeight: 500,
  fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
  flex: "none",
  display: "flex",
  alignItems: "center",
};

function Avatar({ initial, size = 40 }: { initial: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: look.soft, color: look.softInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 500, flex: "none" }}>
      {initial}
    </span>
  );
}

/** The slot MY-3's floating button mounts into. Empty until then. */
function FloatingSlot({ children }: { children?: React.ReactNode }) {
  return (
    <div data-slot="floating-button" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
      {children}
    </div>
  );
}

function Amounts({ amounts }: { amounts: readonly PersonAmount[] }) {
  if (amounts.length === 0) return <span style={{ fontSize: 15, fontWeight: 500, color: look.muted }}>Settled</span>;
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      {amounts.map((a) => (
        <span key={a.currency} data-currency={a.currency} style={{ fontSize: 15, fontWeight: 500, color: TONE[a.tone] }}>
          {a.text}
        </span>
      ))}
    </span>
  );
}

export interface PeopleListProps {
  theme: LookTheme;
  /** MY-4's title and Groups | People switch. */
  header?: React.ReactNode;
  /** MY-3's floating button (kind "people"). */
  floatingButton?: React.ReactNode;
  people: readonly SplitecoPersonBalance[];
  query: string;
  onQuery: (query: string) => void;
  onOpenPerson: (subjectId: string) => void;
  /** Pay: opens the settle box for this person (MY-6). */
  onPay: (person: SplitecoPersonBalance) => void;
  /** Got it: they paid you; the host records it. */
  onGotIt: (person: SplitecoPersonBalance) => void;
}

function Row({ row, first, onOpen, onAction }: { row: PersonRowView; first: boolean; onOpen: () => void; onAction: () => void }) {
  return (
    <div data-person={row.subjectId} style={{ boxSizing: "content-box", display: "flex", alignItems: "center", gap: 12, height: B.personRow.height, padding: `0 ${B.personRow.padRight}px 0 ${B.personRow.padLeft}px`, borderTop: first ? undefined : `1px solid ${look.line}` }}>
      <button type="button" onClick={onOpen} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, border: 0, background: "transparent", color: look.ink, padding: 0, textAlign: "left", fontFamily: "inherit", fontVariantNumeric: "tabular-nums", cursor: "pointer", height: "100%" }}>
        <Avatar initial={row.initial} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{row.name}</span>
          {row.groupsText ? <span style={{ fontSize: 13, color: look.muted }}>{row.groupsText}</span> : null}
        </span>
        <Amounts amounts={row.amounts} />
      </button>
      {row.action === "settled" ? null : (
        <button type="button" onClick={onAction} style={{ ...softButton, padding: row.action === "pay" ? "0 18px" : "0 16px" }}>
          {row.action === "pay" ? "Pay" : "Got it"}
        </button>
      )}
    </div>
  );
}

/** People: everyone you split with, once each, with Pay or Got it. */
export function PeopleList({ theme, header, floatingButton, people, query, onQuery, onOpenPerson, onPay, onGotIt }: PeopleListProps) {
  const shown = searchPeople(people, query);
  return (
    <LookScope theme={theme} style={{ position: "relative", minHeight: "100%", fontFamily: FONT, fontVariantNumeric: "tabular-nums", lineHeight: "normal" }}>
      <div data-page="people" style={{ padding: `${B.page.padTop}px ${B.page.padX}px var(--cp-page-end, 120px)`, display: "flex", flexDirection: "column", gap: B.page.gapPeople }}>
        {header}
        <label style={{ height: B.search.height, borderRadius: B.search.radius, background: look.surface, display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input aria-label="Search people" placeholder="Search people" value={query} onChange={(e) => onQuery(e.target.value)} style={{ flex: 1, border: 0, background: "transparent", fontSize: 16, color: look.ink, outline: "none", minWidth: 0, fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }} />
        </label>
        {people.length === 0 ? (
          <div data-empty="people" style={{ background: look.surface, borderRadius: 22, padding: 20, fontSize: 15, color: look.muted }}>
            No one yet
          </div>
        ) : shown.length === 0 ? (
          <div data-empty="search" style={{ background: look.surface, borderRadius: 22, padding: 20, fontSize: 15, color: look.muted }}>
            No one by that name
          </div>
        ) : (
          <div style={{ background: look.surface, borderRadius: 22, overflow: "hidden" }}>
            {shown.map((p, i) => (
              <Row key={p.subjectId} row={personRow(p)} first={i === 0} onOpen={() => onOpenPerson(p.subjectId)} onAction={() => (personRow(p).action === "pay" ? onPay(p) : onGotIt(p))} />
            ))}
          </div>
        )}
      </div>
      <FloatingSlot>{floatingButton}</FloatingSlot>
    </LookScope>
  );
}

export interface PersonPageProps {
  theme: LookTheme;
  person: SplitecoPersonBalance;
  onBack: () => void;
  /** MY-3's floating button (kind "settle", for this person). */
  floatingButton?: React.ReactNode;
}

/** A person's page: the net, then the balance by group, the Kitchen first. */
export function PersonPage({ theme, person, onBack, floatingButton }: PersonPageProps) {
  const v = personPage(person);
  return (
    <LookScope theme={theme} style={{ position: "relative", minHeight: "100%", fontFamily: FONT, fontVariantNumeric: "tabular-nums", lineHeight: "normal" }}>
      <div data-page="person" style={{ padding: `${B.page.padTop}px ${B.page.padX}px var(--cp-page-end, 120px)`, display: "flex", flexDirection: "column", gap: B.page.gapPerson }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, height: 56 }}>
          <button type="button" aria-label="Back" onClick={onBack} style={{ width: 44, height: 44, marginLeft: -10, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", border: 0, background: "transparent", cursor: "pointer" }}>
            <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <Avatar initial={v.initial} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em" }}>{v.name}</h1>
        </header>
        <section data-net="" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 4px" }}>
          {v.settled ? (
            <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em", color: look.muted }}>Settled</span>
          ) : (
            v.nets.map((n) => (
              <div key={n.currency} data-currency={n.currency} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em", color: TONE[n.tone] }}>{n.text}</span>
                <span style={{ fontSize: 14, color: look.muted }}>{n.words}</span>
              </div>
            ))
          )}
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ margin: 0, padding: "0 2px", fontSize: 13, fontWeight: 500, color: look.muted }}>By group · Kitchen first</h2>
          <div data-groups="" style={{ background: look.surface, borderRadius: 20, overflow: "hidden" }}>
            {v.groups.map((g, i) => (
              <div key={g.groupId} data-group={g.groupId} data-currency={g.currency} style={{ boxSizing: "content-box", display: "flex", alignItems: "center", height: B.personGroupRow.height, padding: "0 16px", borderTop: i === 0 ? undefined : `1px solid ${look.line}` }}>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{g.label}</span>
                <span style={{ fontSize: 15, fontWeight: 500, color: TONE[g.tone] }}>{g.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <FloatingSlot>{floatingButton}</FloatingSlot>
    </LookScope>
  );
}

type Read = { data: SplitecoBalancesResponse | null; error: string | null; loading: boolean };

function useBalances(api: SplitecoPeopleApi): Read & { reload: () => void } {
  const [state, setState] = React.useState<Read>({ data: null, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.balances().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => live && setState({ data: null, error: e instanceof Error ? e.message : "Couldn't load", loading: false }),
    );
    return () => {
      live = false;
    };
  }, [api, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

function Notice({ theme, text, onRetry }: { theme: LookTheme; text: string; onRetry?: () => void }) {
  return (
    <LookScope theme={theme} style={{ minHeight: "100%", fontFamily: FONT }}>
      <div style={{ padding: 20 }}>
        <div style={{ background: look.surface, borderRadius: 22, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, fontSize: 14, color: look.muted }}>{text}</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} style={softButton}>
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </LookScope>
  );
}

export interface PeopleScreenProps extends Omit<PeopleListProps, "people" | "query" | "onQuery"> {
  api: SplitecoPeopleApi;
}

/** People, reading its one endpoint. */
export function PeopleScreen({ api, ...rest }: PeopleScreenProps) {
  const read = useBalances(api);
  const [query, setQuery] = React.useState("");
  if (read.error) return <Notice theme={rest.theme} text="Couldn't load your people." onRetry={read.reload} />;
  return <PeopleList {...rest} people={read.data?.people ?? []} query={query} onQuery={setQuery} />;
}

export interface PersonScreenProps {
  theme: LookTheme;
  api: SplitecoPeopleApi;
  subjectId: string;
  onBack: () => void;
  floatingButton?: React.ReactNode;
}

/** A person's page, reading the same one endpoint. */
export function PersonScreen({ api, subjectId, theme, onBack, floatingButton }: PersonScreenProps) {
  const read = useBalances(api);
  if (read.error) return <Notice theme={theme} text="Couldn't load this person." onRetry={read.reload} />;
  if (read.loading && !read.data) return <Notice theme={theme} text="Loading…" />;
  const person = findPerson(read.data, subjectId);
  if (!person) return <Notice theme={theme} text="You no longer share a group with them." />;
  return <PersonPage theme={theme} person={person} onBack={onBack} floatingButton={floatingButton} />;
}
