"use client";

// Money-native MY-6: what is inside the expanding button's `settle` and
// `people` boxes (boards ExpandButton, Settle_Custom, Person_Dev). Settle: All,
// Kitchen only or Custom (a keypad), the Kitchen clearing first, UPI or Cash,
// then Paid, which RECORDS a payment made in the person's own UPI app; nothing
// is paid here. Settle up lists the simplified payments with Paid / Got it each
// and Settle all. The API is injected (`api.recordPayment`), so Cookpool and the
// Spliteco app each pass their own. Colours are tokens only (./look.ts).

import * as React from "react";
import type { SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { ExpandButton, type ExpandButtonApi } from "./expand-button.js";
import { look, type LookTheme } from "./look.js";
import { formatShort } from "./money.js";
import {
  allocate,
  keypadDisplay,
  keypadMinor,
  keypadPress,
  kitchenOwed,
  lineText,
  linesTotal,
  planRows,
  recordPayments,
  requestKey,
  requestsOf,
  settleCurrencies,
  settleGroups,
  sumOwed,
  type KeypadKey,
  type PaymentRequest,
  type PlanRow,
  type SettleApi,
  type SettleDirection,
  type SettleLine,
  type SettleMethod,
  type SettleMode,
} from "./settle-box.js";
import { ctaText, initialSettle, settleStep, upiLink, type SettleState } from "./settle.js";

/** The box is taller than the Settle_Money sketch: the Custom keypad needs the room. */
export const SETTLE_BOX_HEIGHT = 700;
export const SETTLE_UP_BOX_HEIGHT = 430;

const primaryButton: React.CSSProperties = {
  height: 52, border: 0, borderRadius: 12, background: look.primary, color: look.onPrimary,
  fontSize: 15, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", flex: "none",
};
const softButton: React.CSSProperties = {
  height: 44, padding: "0 14px", border: 0, borderRadius: 10, background: look.soft, color: look.softInk,
  fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", flex: "none",
};

function Done({ title, onDone }: { title: string; onDone: () => void }) {
  return (
    <div data-step="done" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: 50 }}>
      <span aria-hidden style={{ width: 64, height: 64, borderRadius: "50%", background: look.soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={look.primary} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <span style={{ fontSize: 22, fontWeight: 500 }}>{title}</span>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onDone} style={{ ...primaryButton, alignSelf: "stretch" }}>Done</button>
    </div>
  );
}

const messageOf = (names: string[], recorded: string[]) =>
  `${recorded.length > 0 ? `Recorded: ${recorded.join(", ")}. ` : ""}Not recorded: ${names.join(", ")}.`;

function Avatar({ initial }: { initial: string }) {
  return (
    <span aria-hidden style={{ width: 34, height: 34, borderRadius: "50%", background: look.soft, color: look.softInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flex: "none" }}>
      {initial}
    </span>
  );
}

// ── Settle with a person ──────────────────────────────────

export interface SettleContentProps {
  theme: LookTheme;
  person: Pick<SplitecoPersonBalance, "subjectId" | "name" | "groups" | "upiVpa">;
  meId: string;
  /** `pay` (default): you pay them. `got`: they paid you, and the box records it. */
  direction?: SettleDirection;
  /** The currency to settle; left out, the one with the most open. */
  currency?: string;
  api: SettleApi;
  /** Opens the UPI app with the link (`window.location.href = url`, or the host's own). Left out, Paid records straight away. */
  openUpi?: (url: string) => void;
  /** Called once everything is recorded, so the host can read the balances again. */
  onRecorded?: () => void;
  /** Done, or the close button of the box. */
  onDone: () => void;
}

const KEYS: Array<{ key: KeypadKey; label: string; name: string }> = [
  ..."123456789".split("").map((d) => ({ key: d as KeypadKey, label: d, name: d })),
  { key: ".", label: ".", name: "Decimal point" },
  { key: "0", label: "0", name: "0" },
  { key: "back", label: "⌫", name: "Delete" },
];

/** The settle box's content. Mount it as the children of an `ExpandButton` (kind `settle`), or use `SettleBox`. */
export function SettleContent({ person, meId, direction = "pay", currency: wanted, api, openUpi, onRecorded, onDone }: SettleContentProps) {
  const name = person.name?.trim() || "Someone";
  const currency = wanted ?? settleCurrencies(person, direction)[0] ?? "INR";
  const groups = React.useMemo(() => settleGroups(person, direction, currency), [person, direction, currency]);
  const owed = sumOwed(groups);
  const kitchen = groups.reduce((s, g) => s + kitchenOwed(g), 0);

  const [mode, setMode] = React.useState<SettleMode>("all");
  const [typed, setTyped] = React.useState("");
  const [flow, setFlow] = React.useState<SettleState>(() => initialSettle("upi"));
  const [recorded, setRecorded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const [paidMinor, setPaidMinor] = React.useState(0);

  const lines = allocate(groups, mode, keypadMinor(typed));
  const total = linesTotal(lines);
  const who = direction === "pay" ? { fromSubjectId: meId, toSubjectId: person.subjectId } : { fromSubjectId: person.subjectId, toSubjectId: meId };
  const method: SettleMethod = flow.method === "cash" ? "cash" : "upi";
  const requests = requestsOf(lines, who, method);
  const started = recorded.size > 0;
  const keyOf = (l: SettleLine) => requestKey(requests.find((r) => r.groupId === l.groupId)!);
  const remaining = lines.filter((l) => !recorded.has(keyOf(l)));
  const remainingMinor = linesTotal(remaining);
  const link = direction === "pay" ? upiLink({ vpa: person.upiVpa, name, amountMinor: remainingMinor, note: "Settle up", currency }) : null;
  const willOpenUpi = flow.method === "upi" && link !== null && openUpi !== undefined;

  async function record() {
    const outcome = await recordPayments(api, requests, recorded);
    setRecorded(new Set(outcome.recorded));
    setFailed(new Map(outcome.failed.map((f) => [f.groupId, f.message])));
    if (outcome.failed.length > 0) {
      const nameOf = (id: string) => lines.find((l) => l.groupId === id)?.label ?? id;
      const done = lines.filter((l) => outcome.recorded.includes(keyOf(l))).map((l) => l.label);
      setFlow((s) => settleStep(s, { type: "failed", message: messageOf(outcome.failed.map((f) => nameOf(f.groupId)), done) }).state);
      return;
    }
    setPaidMinor(total);
    setFlow((s) => settleStep(s, { type: "saved" }).state);
    onRecorded?.();
  }

  function press() {
    if (total <= 0) return;
    if (direction === "pay" && willOpenUpi && flow.step === "pick") {
      setFlow((s) => settleStep(s, { type: "go" }).state);
      openUpi!(link!);
      return;
    }
    // Cash, a UPI payment already made, or back from the UPI app: record it.
    setFlow((s) => ({ ...s, step: "saving", error: null }));
    void record();
  }

  if (groups.length === 0 && flow.step !== "done") {
    return <Done title="All settled" onDone={onDone} />;
  }
  if (flow.step === "done") {
    return <Done title={direction === "pay" ? `Paid ${name} ${formatShort(paidMinor, currency)}` : `${name} paid you ${formatShort(paidMinor, currency)}`} onDone={onDone} />;
  }

  const left = owed - total;
  const note = mode === "kitchen" ? "Kitchen only" : mode === "custom" ? `${formatShort(left, currency)} left to settle` : "";
  const chips: Array<{ mode: SettleMode; label: string }> = [
    { mode: "all", label: `All ${formatShort(owed, currency)}` },
    ...(kitchen > 0 ? [{ mode: "kitchen" as const, label: `Kitchen ${formatShort(kitchen, currency)}` }] : []),
    { mode: "custom", label: "Custom" },
  ];
  const saving = flow.step === "saving";
  const confirming = flow.step === "confirm";
  const cta = confirming || !willOpenUpi || direction === "got"
    ? `${direction === "pay" ? "Paid" : "Got it"} ${formatShort(remainingMinor, currency)}`
    : ctaText("upi", remainingMinor, name, currency);

  return (
    <div data-box="settle" data-direction={direction} data-step={flow.step} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <span data-amount="" style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 2 }}>
          {mode === "custom" ? keypadDisplay(typed, currency) : formatShort(total, currency)}
          {mode === "custom" ? <span aria-hidden style={{ width: 2, height: 38, background: look.primary }} /> : null}
        </span>
        <span style={{ fontSize: 14, color: look.muted, minHeight: 20 }}>{note}</span>
      </div>
      <div role="group" aria-label="Amount" style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {chips.map((c) => (
          <button
            key={c.mode}
            type="button"
            aria-pressed={mode === c.mode}
            disabled={started || saving || confirming}
            onClick={() => setMode(c.mode)}
            style={{ height: 44, padding: "0 16px", border: 0, borderRadius: 10, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", background: mode === c.mode ? look.primary : look.bg, color: mode === c.mode ? look.onPrimary : look.ink }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div data-lines="" style={{ background: look.bg, borderRadius: 14, overflow: "hidden" }}>
        <h3 style={{ margin: 0, padding: "12px 14px 2px", fontSize: 13, fontWeight: 500, color: look.muted }}>Kitchen goes first</h3>
        {lines.map((l, i) => (
          <LineRow key={l.groupId} line={l} custom={mode === "custom"} first={i === 0} status={statusOf(recorded, failed, requests, l)} />
        ))}
      </div>
      {mode === "custom" && !started ? (
        <div data-keypad="" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {KEYS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-label={k.name}
              disabled={saving || confirming}
              onClick={() => setTyped((t) => keypadPress(t, k.key, owed))}
              style={{ height: 52, border: 0, borderRadius: 16, background: look.bg, color: look.ink, fontSize: 22, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}
            >
              {k.label}
            </button>
          ))}
        </div>
      ) : null}
      <div role="group" aria-label="Method" style={{ display: "flex", gap: 8 }}>
        {(["upi", "cash"] as const).map((m) => {
          const on = flow.method === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              disabled={saving || confirming}
              onClick={() => setFlow((s) => settleStep(s, { type: "pick", method: m }).state)}
              style={{ flex: 1, height: 44, border: 0, borderRadius: 10, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", background: on ? look.soft : "transparent", color: on ? look.softInk : look.ink, boxShadow: on ? undefined : `inset 0 0 0 1px ${look.grab}` }}
            >
              {m === "upi" ? "UPI" : "Cash"}
            </button>
          );
        })}
      </div>
      {flow.error ? <p role="alert" data-error="" style={{ margin: 0, fontSize: 13, color: look.owe }}>{flow.error}</p> : null}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 8 }}>
        {confirming ? (
          <button type="button" onClick={() => setFlow((s) => settleStep(s, { type: "didnt" }).state)} style={{ ...softButton, height: 52, borderRadius: 12 }}>
            Not paid
          </button>
        ) : null}
        <button type="button" data-action="paid" disabled={saving || total <= 0} onClick={press} style={{ ...primaryButton, flex: 1, opacity: saving || total <= 0 ? 0.6 : 1 }}>
          {cta}
        </button>
      </div>
    </div>
  );
}

type Status = "recorded" | "failed" | null;
function statusOf(recorded: ReadonlySet<string>, failed: ReadonlyMap<string, string>, requests: readonly PaymentRequest[], l: SettleLine): Status {
  const r = requests.find((x) => x.groupId === l.groupId);
  if (r && recorded.has(requestKey(r))) return "recorded";
  return failed.has(l.groupId) ? "failed" : null;
}

function LineRow({ line, custom, first, status }: { line: SettleLine; custom: boolean; first: boolean; status: Status }) {
  const text = status === "recorded" ? "Recorded" : status === "failed" ? "Not recorded" : custom ? lineText(line) : formatShort(line.paidMinor, line.currency);
  const colour = status === "recorded" ? look.get : status === "failed" ? look.owe : custom && line.paidMinor >= line.owedMinor ? look.get : look.ink;
  return (
    <div data-line={line.groupId} data-status={status ?? ""} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 14px", borderTop: first ? undefined : `1px solid ${look.line}` }}>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{line.label}</span>
      <span style={{ fontSize: 15, fontWeight: 500, color: colour }}>{text}</span>
    </div>
  );
}

/** Only the box props that were given: ExpandButton's own defaults apply to the rest. */
function boxProps(p: { bottomOffset?: number | undefined; contained?: boolean | undefined; reduceMotion?: boolean | undefined; open?: boolean | undefined; onOpenChange?: ((open: boolean) => void) | undefined }) {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as {
    bottomOffset?: number; contained?: boolean; reduceMotion?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void;
  };
}

export interface SettleBoxProps extends Omit<SettleContentProps, "onDone"> {
  /** Where the button sits above the tab bar (see ExpandButton). */
  bottomOffset?: number;
  contained?: boolean;
  boxHeight?: number;
  reduceMotion?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** The person page's floating button and its settle box: `<PersonPage floatingButton={<SettleBox … />} />`. */
export function SettleBox({ theme, person, direction = "pay", currency: wanted, boxHeight = SETTLE_BOX_HEIGHT, bottomOffset, contained, reduceMotion, open, onOpenChange, ...content }: SettleBoxProps) {
  const name = person.name?.trim() || "Someone";
  const currency = wanted ?? settleCurrencies(person, direction)[0] ?? "INR";
  const total = sumOwed(settleGroups(person, direction, currency));
  if (total <= 0) return null;
  return (
    <ExpandButton
      kind="settle"
      theme={theme}
      label={`${direction === "pay" ? "Settle" : "Got it"} ${formatShort(total, currency)}`}
      title={direction === "pay" ? `Settle with ${name}` : `${name} paid you`}
      boxHeight={boxHeight}
      {...boxProps({ bottomOffset, contained, reduceMotion, open, onOpenChange })}
    >
      {({ close }: ExpandButtonApi) => <SettleContent theme={theme} person={person} direction={direction} currency={currency} {...content} onDone={close} />}
    </ExpandButton>
  );
}

// ── Settle up (People) ────────────────────────────────────

export interface SettleUpContentProps {
  theme: LookTheme;
  people: readonly SplitecoPersonBalance[];
  meId: string;
  api: SettleApi;
  onRecorded?: () => void;
  onDone: () => void;
}

/** People's Settle up: each simplified payment with Paid or Got it, and Settle all. */
export function SettleUpContent({ people, meId, api, onRecorded, onDone }: SettleUpContentProps) {
  // Read once: the host reloads its balances as payments land, and the rows must stay to show what was recorded.
  const [rows] = React.useState(() => planRows(people, meId));
  const [recorded, setRecorded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const [busy, setBusy] = React.useState(false);
  const [finished, setFinished] = React.useState(false);

  const isDone = (r: PlanRow, set: ReadonlySet<string> = recorded) => r.requests.every((q) => set.has(requestKey(q)));
  const pending = rows.filter((r) => !isDone(r));

  async function run(targets: readonly PlanRow[]) {
    setBusy(true);
    const outcome = await recordPayments(api, targets.flatMap((r) => r.requests), recorded);
    const next = new Set(outcome.recorded);
    setRecorded(next);
    setFailed(new Map(outcome.failed.map((f) => [f.key, f.message])));
    setBusy(false);
    onRecorded?.();
    if (rows.every((r) => isDone(r, next))) setFinished(true);
  }

  if (finished || rows.length === 0) return <Done title="All settled" onDone={onDone} />;

  const failedRows = rows.filter((r) => r.requests.some((q) => failed.has(requestKey(q))));
  const doneRows = rows.filter((r) => isDone(r));
  return (
    <div data-box="settle-up" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: look.bg, borderRadius: 14, overflow: "hidden" }}>
        {rows.map((r, i) => {
          const ok = isDone(r);
          const bad = r.requests.some((q) => failed.has(requestKey(q)));
          return (
            <div key={r.key} data-row={r.key} data-direction={r.direction} data-status={ok ? "recorded" : bad ? "failed" : ""} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "0 10px 0 14px", borderTop: i === 0 ? undefined : `1px solid ${look.line}` }}>
              <Avatar initial={r.initial} />
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{r.direction === "pay" ? `You pay ${r.name}` : `${r.name} pays you`}</span>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{formatShort(r.amountMinor, r.currency)}</span>
              {ok ? (
                <span role="img" aria-label="Recorded" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={look.get} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </span>
              ) : (
                <button type="button" data-action={r.direction === "pay" ? "paid" : "got"} disabled={busy} onClick={() => void run([r])} style={{ ...softButton, color: bad ? look.owe : look.softInk }}>
                  {r.direction === "pay" ? "Paid" : "Got it"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {failedRows.length > 0 ? (
        <p role="alert" data-error="" style={{ margin: 0, fontSize: 13, color: look.owe }}>
          {messageOf(failedRows.map((r) => (r.direction === "pay" ? `You pay ${r.name}` : `${r.name} pays you`)), doneRows.map((r) => (r.direction === "pay" ? `You pay ${r.name}` : `${r.name} pays you`)))}
        </p>
      ) : null}
      <span style={{ flex: 1 }} />
      <button type="button" data-action="settle-all" disabled={busy || pending.length === 0} onClick={() => void run(pending)} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
        Settle all {pending.length}
      </button>
    </div>
  );
}

export interface SettleUpBoxProps extends Omit<SettleUpContentProps, "onDone"> {
  bottomOffset?: number;
  contained?: boolean;
  boxHeight?: number;
  reduceMotion?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** People's floating Settle up: `<PeopleScreen floatingButton={<SettleUpBox … />} />`. */
export function SettleUpBox({ theme, boxHeight = SETTLE_UP_BOX_HEIGHT, bottomOffset, contained, reduceMotion, open, onOpenChange, ...content }: SettleUpBoxProps) {
  if (planRows(content.people, content.meId).length === 0) return null;
  return (
    <ExpandButton kind="people" theme={theme} label="Settle up" boxHeight={boxHeight} {...boxProps({ bottomOffset, contained, reduceMotion, open, onOpenChange })}>
      {({ close }: ExpandButtonApi) => <SettleUpContent theme={theme} {...content} onDone={close} />}
    </ExpandButton>
  );
}
