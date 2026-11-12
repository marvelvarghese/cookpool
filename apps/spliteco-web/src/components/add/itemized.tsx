"use client";

import * as React from "react";
import type { SplitecoAdjustmentKind, SplitecoItemShareMode, SplitecoSplitMethod } from "@saas/contracts/spliteco";
import { owedBySplit } from "@saas/kitchen-engine/splits";
import { Icon } from "@/components/icons";
import { BackButton } from "@/components/ui";
import { formatMoney, formatShort } from "@/lib/money";
import { initialOf, nameOf, tintOf } from "@/lib/people";
import {
  adjustmentAmount,
  adjustmentsTotal,
  METHOD_LABELS,
  emptyItem,
  enteredItems,
  itemTotal,
  itemsSubtotal,
  newKey,
  splitInput,
  toSpec,
  totalOf,
  type AdjustmentForm,
  type ItemForm,
} from "@/lib/split-form";
import {
  DEFAULT_SHARE,
  EXACT_STEPS,
  PCT_CHIPS,
  PORTION_CHIPS,
  everyone,
  itemAmounts,
  itemStatus,
  modeHint,
  resetItem,
  setShare,
  shareBadge,
  splitEvenly,
  stepExact,
  switchMode,
} from "@/lib/itemized";
import type { FormCtx } from "./types";
import { addEveryone, peopleLine, peopleOn, pickable, sameAsLast, sharesToShow } from "@/lib/item-people";
import { clampIndex, indexAfterRemove, itemHasProblem, swipeDirection } from "@/lib/carousel";

interface Props {
  ctx: FormCtx;
  title: string;
  groupName: string;
  onBack: () => void;
  /** Leave Itemized for another method (the items are cleared). */
  onSwitch: (method: Exclude<SplitecoSplitMethod, "items">) => void;
  onSave: () => void;
  canSave: boolean;
  busy: boolean;
  error: string | null;
  /** SE4: open this bill as a live split, so people at the table claim their own items. */
  onLive?: () => void;
  liveBusy?: boolean;
}

/** Itemized: tap a face to add them to an item, tap again to say how much they had. */
export function ItemizedView({ ctx, title, groupName, onBack, onSwitch, onSave, canSave, busy, error, onLive, liveBusy }: Props) {
  const { form, setForm, names, me, currency } = ctx;
  const [edit, setEdit] = React.useState<{ item: string; who: string } | null>(null);
  const [menu, setMenu] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState(0);
  const [picker, setPicker] = React.useState<string | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const entered = enteredItems(form);
  const [search, setSearch] = React.useState("");
  const swipeX = React.useRef<number | null>(null);
  const chipsRef = React.useRef<HTMLDivElement | null>(null);
  const count = form.items.length;
  const cur = clampIndex(current, count);
  const go = (i: number) => {
    const next = clampIndex(i, count);
    setCurrent(next);
    setEdit(null);
    setMenu(null);
    setPicker(null);
    chipsRef.current?.querySelectorAll("button")[next]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  };
  const subtotal = itemsSubtotal(form);
  const bill = totalOf(form) ?? 0;
  const owed = bill > 0 || form.items.length > 0 ? owedBySplit(Math.max(0, bill), toSpec(splitInput(form))) : null;
  const unassigned = form.items.reduce((s, it) => {
    const { result } = itemAmounts(it, form.members);
    return s + Math.max(0, result.gapMinor);
  }, 0);
  const over = form.items.reduce((s, it) => {
    const { result } = itemAmounts(it, form.members);
    return s + Math.max(0, -result.gapMinor);
  }, 0);
  const payer = form.payerMode === "one" ? `${nameOf(names, form.payer, me)} paid` : "several paid";

  const updateItem = (key: string, fn: (it: ItemForm) => ItemForm) =>
    setForm((f) => ({ ...f, items: f.items.map((it) => (it.key === key ? fn(it) : it)) }));

  return (
    <div className="page" style={{ padding: "0 0 40px", gap: 14 }}>
      <header className="hdr">
        <BackButton label="Back to the expense" onClick={onBack} />
        <div className="hdr-title" style={{ flex: 1 }}>
          <h1 className="ellipsis" style={{ maxWidth: "100%" }}>{title}</h1>
          <span>{groupName} · {payer} · itemized</span>
        </div>
        {onLive ? (
          <button className="pillbtn" onClick={onLive} disabled={liveBusy} aria-label="Split live: everyone at the table claims their own items" style={{ fontWeight: 500, color: "var(--ok)" }}>
            <Icon name="live" size={16} /> {liveBusy ? "Opening…" : "Live"}
          </button>
        ) : null}
        <button className="pillbtn" onClick={onBack} style={{ fontWeight: 500 }}>Done</button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <div className="stat"><span className="label">Items</span><span className="value">{form.items.length}</span></div>
        <div className="stat"><span className="label">Subtotal</span><span className="value">{formatShort(subtotal, currency)}</span></div>
        <div className="stat"><span className="label">Bill total</span><span className="value money">{formatShort(bill, currency)}</span></div>
      </div>
      <div className="row-between panel" style={{ padding: "8px 8px 8px 14px", borderRadius: 14, flexDirection: "row", gap: 8 }}>
        <span style={{ fontSize: 14 }} className="muted">
          Split method <b style={{ color: "var(--text)" }}>Itemized</b>
        </span>
        <button className="pillbtn" aria-expanded={switching} onClick={() => setSwitching(!switching)} style={{ background: "var(--raised)", fontWeight: 500 }}>
          Change ▾
        </button>
      </div>
      {switching ? (
        <section aria-label="Change split method" className="ipanel">
          <span style={{ fontSize: 14, fontWeight: 500 }}>Switch to another method?</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
            {SWITCH_TO.map((m) => (
              <button
                key={m}
                className="btn surface"
                style={{ height: 48, padding: 0, fontSize: 13 }}
                aria-label={`Split ${METHOD_LABELS[m].phrase} instead`}
                onClick={() => {
                  setSwitching(false);
                  onSwitch(m);
                }}
              >
                {SWITCH_LABELS[m]}
              </button>
            ))}
          </div>
          {entered > 0 ? (
            <span className="small" style={{ color: "var(--money)" }} role="note">
              Your {entered} item{entered === 1 ? "" : "s"} will be cleared. The bill total ({formatMoney(bill, currency)}) stays.
            </span>
          ) : (
            <span className="small dim">The bill total ({formatMoney(bill, currency)}) stays.</span>
          )}
          <button className="btn ghost" onClick={() => setSwitching(false)}>
            {entered > 0 ? "Keep items" : "Stay on Itemized"}
          </button>
        </section>
      ) : null}
      <label className="field">
        <span className="sr">What was it for?</span>
        <input placeholder="What was it for? (Beach shack dinner)" maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={{ fontWeight: 500 }} />
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        One item per slide — swipe or use the arrows. Tap a face to add them; tap again to say how much they had.
      </p>

      {count > 0 ? (
        <>
          <div className="row-between">
            <button className="iconbtn" aria-label="Previous item" onClick={() => go(cur - 1)} disabled={cur === 0} style={{ opacity: cur > 0 ? 1 : 0.4 }}>
              <Icon name="back" />
            </button>
            <span style={{ fontSize: 14, fontWeight: 500 }} aria-live="polite">Item {cur + 1} of {count}</span>
            <button className="iconbtn" aria-label="Next item" onClick={() => go(cur + 1)} disabled={cur >= count - 1} style={{ opacity: cur < count - 1 ? 1 : 0.4 }}>
              <Icon name="chevron" />
            </button>
          </div>
          <div role="tablist" aria-label="Items" ref={chipsRef} style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
            {form.items.map((it, i) => {
              const on = i === cur;
              const bad = itemHasProblem(it, form.members);
              return (
                <button
                  key={it.key}
                  role="tab"
                  aria-selected={on}
                  aria-label={`${it.name || `Item ${i + 1}`}${bad ? ", needs fixing" : ""}`}
                  onClick={() => go(i)}
                  style={{ flex: "none", height: 36, padding: "0 12px", borderRadius: 999, background: on ? "var(--cobalt-soft)" : "var(--surface)", border: `1px solid ${on ? "var(--cobalt-ring)" : "var(--line)"}`, color: on ? "var(--text)" : "var(--muted)", fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: bad ? "var(--owe)" : "var(--ok)" }} />
                  {it.name || `Item ${i + 1}`}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <div
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          // Selecting text in a field is not a swipe.
          swipeX.current = (e.target as HTMLElement).closest("input") ? null : e.clientX;
        }}
        onPointerUp={(e) => {
          if (swipeX.current === null) return;
          const dir = swipeDirection(e.clientX - swipeX.current);
          swipeX.current = null;
          if (dir !== 0) go(cur + dir);
        }}
        onPointerCancel={() => {
          swipeX.current = null;
        }}
      >
      {form.items.map((item, index) => {
        if (index !== cur) return null;
        const total = itemTotal(item);
        const status = itemStatus(item, form.members, currency);
        const { amounts } = itemAmounts(item, form.members);
        const menuOn = menu === item.key;
        const editing = edit?.item === item.key ? edit.who : null;
        return (
          <article key={item.key} className={`item ${status.tone === "bad" ? "bad" : ""}`} aria-label={item.name || `Item ${index + 1}`} style={{ minHeight: 400 }}>
            <div className="inline" style={{ gap: 10, flexWrap: "nowrap" }}>
              <div className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <input
                  aria-label={`Item ${index + 1} name`}
                  placeholder="Item name"
                  value={item.name}
                  maxLength={120}
                  onChange={(e) => updateItem(item.key, (it) => ({ ...it, name: e.target.value }))}
                  style={{ background: "transparent", border: 0, outline: "none", color: "var(--text)", fontSize: 15, fontWeight: 500, padding: 0, minWidth: 0 }}
                />
                <span className="small" style={{ color: status.tone === "bad" ? "var(--owe)" : status.tone === "warn" ? "var(--money)" : "var(--dim)" }}>
                  {status.text}
                </span>
              </div>
              <span className="money" style={{ fontSize: 15, fontWeight: 500 }}>{total === null ? "—" : formatShort(total, currency)}</span>
              <button
                aria-label={`Actions for ${item.name || `item ${index + 1}`}`}
                aria-expanded={menuOn}
                className="iconbtn"
                style={{ width: 44, height: 44, borderRadius: 12, background: menuOn ? "var(--cobalt-soft)" : "var(--raised)", color: "var(--muted)" }}
                onClick={() => {
                  setMenu(menuOn ? null : item.key);
                  setEdit(null);
                  setPicker(null);
                }}
              >
                <Icon name="more" />
              </button>
            </div>
            {menuOn ? (
              <div className="menu4">
                <button onClick={() => updateItem(item.key, (it) => everyone(it, form.members))}>Everyone</button>
                <button onClick={() => updateItem(item.key, splitEvenly)}>Split evenly</button>
                <button onClick={() => updateItem(item.key, resetItem)}>Reset</button>
                <button
                  className="del"
                  onClick={() => {
                    setForm((f) => ({ ...f, items: f.items.filter((it) => it.key !== item.key) }));
                    setCurrent(indexAfterRemove(cur, index, count - 1));
                    setMenu(null);
                    setEdit(null);
                  }}
                >
                  Remove item
                </button>
              </div>
            ) : null}
            <div className="item-fields">
              <span className="small dim" style={{ gridColumn: "1 / 2", alignSelf: "center" }}>Qty · price · line total</span>
              <input aria-label="Quantity" inputMode="decimal" value={item.qtyText} onChange={(e) => updateItem(item.key, (it) => ({ ...it, qtyText: e.target.value }))} />
              <input aria-label="Price of one" inputMode="decimal" placeholder="each" value={item.unitText} onChange={(e) => updateItem(item.key, (it) => ({ ...it, unitText: e.target.value }))} />
              <input aria-label="Line total" inputMode="decimal" placeholder={total !== null && !item.totalText ? String(total / 100) : "total"} value={item.totalText} onChange={(e) => updateItem(item.key, (it) => ({ ...it, totalText: e.target.value }))} />
            </div>
            <div className="tiles">
              {peopleOn(item, form.members).map((id) => {
                const share = item.shares[id];
                const on = !!share;
                const open = editing === id;
                const t = tintOf(id, me);
                const name = nameOf(names, id, me);
                const badge = shareBadge(share);
                return (
                  <button
                    key={id}
                    className="ptile"
                    aria-pressed={on}
                    aria-label={on ? `${name} had ${item.name || "this"} — tap to change how much` : `Add ${name} to ${item.name || "this item"}`}
                    style={{
                      background: on ? t.bg : "var(--inset)",
                      border: open ? "2px solid var(--cobalt-ring)" : `1px solid ${on ? t.fg : "var(--nav-line)"}`,
                      opacity: on ? 1 : 0.6,
                    }}
                    onClick={() => {
                      setMenu(null);
                      if (!on) {
                        updateItem(item.key, (it) => setShare(it, id, { ...DEFAULT_SHARE }));
                        setEdit(null);
                      } else setEdit(open ? null : { item: item.key, who: id });
                      setPicker(null);
                    }}
                  >
                    <span className="n">{name}</span>
                    <span className="avatar" style={{ width: 30, height: 30, background: t.bg, color: t.fg, fontSize: 12 }}>{initialOf(name)}</span>
                    <span className="amt" style={{ color: on ? "var(--text)" : "var(--dim)" }}>{on ? formatShort(amounts.get(id) ?? 0, currency) : formatShort(0, currency)}</span>
                    {badge ? <span className="bdg">{badge}</span> : null}
                  </button>
                );
              })}
              <button
                className="ptile"
                aria-expanded={picker === item.key}
                aria-label={`Add people to ${item.name || "this item"}`}
                style={{ background: "transparent", border: "1px dashed var(--line-strong)", color: "var(--muted)" }}
                onClick={() => {
                  setEdit(null);
                  setMenu(null);
                  setSearch("");
                  setPicker(picker === item.key ? null : item.key);
                }}
              >
                <Icon name="plus" size={22} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>Add</span>
              </button>
            </div>
            <span className="small dim">{peopleLine(peopleOn(item, form.members).length, form.members.length)}</span>
            {picker === item.key ? (
              <section aria-label={`Who had ${item.name || "this item"}`} className="ipanel">
                <div className="row-between">
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Who had {item.name || "this"}?</span>
                  <button className="pillbtn" style={{ fontWeight: 500 }} onClick={() => setPicker(null)}>Done</button>
                </div>
                <label className="field">
                  <Icon name="search" size={18} />
                  <span className="sr">Search the group</span>
                  <input type="search" placeholder={`Search ${form.members.length} people in ${groupName}`} value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                <div className="inline">
                  <button className="chip on" style={{ height: 44 }} onClick={() => updateItem(item.key, (it) => addEveryone(it, form.members))}>
                    Everyone ({form.members.length})
                  </button>
                  {index > 0 ? (
                    <button className="chip" style={{ height: 44 }} onClick={() => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? (sameAsLast(f.items, index, f.members) ?? it) : it)) }))}>
                      Same as last item
                    </button>
                  ) : null}
                </div>
                <div className="stack" style={{ gap: 6, maxHeight: 280, overflowY: "auto" }}>
                  {pickable(item, form.members, (m) => nameOf(names, m, me), search).map((m) => {
                    const t = tintOf(m, me);
                    const name = nameOf(names, m, me);
                    return (
                      <button
                        key={m}
                        className="prow"
                        aria-label={`Add ${name} to ${item.name || "this item"}`}
                        style={{ minHeight: 52, color: "var(--text)", textAlign: "left" }}
                        onClick={() => updateItem(item.key, (it) => setShare(it, m, { ...DEFAULT_SHARE }))}
                      >
                        <span className="avatar" style={{ width: 32, height: 32, background: t.bg, color: t.fg, fontSize: 12 }}>{initialOf(name)}</span>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{name}</span>
                        <span aria-hidden="true" style={{ fontSize: 20, fontWeight: 600, color: "var(--link)" }}>+</span>
                      </button>
                    );
                  })}
                  {pickable(item, form.members, (m) => nameOf(names, m, me), search).length === 0 ? (
                    <span className="small dim">{search.trim() ? "No one by that name who isn't on it already." : "Everyone in the group is on it."}</span>
                  ) : null}
                </div>
              </section>
            ) : null}
            {editing && item.shares[editing] ? (
              <SharePanel
                item={item}
                who={editing}
                name={nameOf(names, editing, me)}
                currentMinor={amounts.get(editing) ?? 0}
                totalMinor={total ?? 0}
                currency={currency}
                me={me}
                onChange={(share) => updateItem(item.key, (it) => setShare(it, editing, share))}
                onClose={() => setEdit(null)}
              />
            ) : null}
          </article>
        );
      })}

      </div>

      {count > 1 ? (
        <div aria-hidden="true" style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          {form.items.map((it, i) => (
            <span key={it.key} style={{ width: i === cur ? 20 : 6, height: 6, borderRadius: 3, background: i === cur ? "#60A5FA" : "var(--line-strong)" }} />
          ))}
        </div>
      ) : null}

      <button
        className="dashed"
        style={{ height: 50, borderRadius: 16 }}
        onClick={() => {
          setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
          setCurrent(count);
          setEdit(null);
          setMenu(null);
          setPicker(null);
        }}
      >
        + Add an item
      </button>

      <Adjustments ctx={ctx} subtotal={subtotal} />

      <section aria-label="Each person pays" className="panel" style={{ borderColor: "var(--line-strong)", gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>Each person&apos;s share</span>
        <div className="grid2" style={{ gap: 8 }}>
          {(owed?.ok ? sharesToShow(owed.value.breakdown) : []).map((line) => {
            const id = line.subjectId;
            const t = tintOf(id, me);
            const name = nameOf(names, id, me);
            return (
              <div key={id} className="tile" style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                <span className="avatar" style={{ width: 32, height: 32, background: t.bg, color: t.fg, fontSize: 12 }}>{initialOf(name)}</span>
                <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                  <span className="small muted ellipsis">{name}</span>
                  <span className="money" style={{ fontSize: 15, fontWeight: 500 }}>{formatMoney(line.owedMinor, currency)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="row-between" style={{ fontSize: 13, paddingTop: 2 }}>
          <span className="muted">
            {owed?.ok
              ? "Adds up to the bill"
              : unassigned > 0
                ? `${formatMoney(unassigned, currency)} not assigned yet`
                : over > 0
                  ? `${formatMoney(over, currency)} too much assigned`
                  : "Add items and who had them"}
          </span>
          <b className={owed?.ok ? "okc" : "owe"}>{owed?.ok ? formatMoney(bill, currency) : `of ${formatMoney(bill, currency)}`}</b>
        </div>
      </section>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn big" onClick={onSave} disabled={!canSave || busy}>
        {busy ? "Saving…" : canSave ? "Save expense" : owed?.ok && !form.title.trim() ? "Say what it was for to save" : "Fix the items to save"}
      </button>
    </div>
  );
}

function SharePanel(props: {
  item: ItemForm;
  who: string;
  name: string;
  currentMinor: number;
  totalMinor: number;
  currency: string;
  me: string | null;
  onChange: (share: { mode: SplitecoItemShareMode; value: number } | null) => void;
  onClose: () => void;
}) {
  const share = props.item.shares[props.who]!;
  const t = tintOf(props.who, props.me);
  const chips = share.mode === "portion" ? PORTION_CHIPS : share.mode === "pct" ? PCT_CHIPS : [];
  const qty = Number(props.item.qtyText) || 1;
  return (
    <section aria-label={`How much ${props.name} had of ${props.item.name || "this item"}`} className="ipanel">
      <div className="row-between">
        <span className="inline" style={{ gap: 8 }}>
          <span className="avatar" style={{ width: 26, height: 26, background: t.bg, color: t.fg, fontSize: 11 }}>{initialOf(props.name)}</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>How much {props.name} had</span>
        </span>
        <button aria-label="Close" className="iconbtn" style={{ width: 44, height: 44, borderRadius: 10, background: "var(--raised)", border: 0, color: "var(--muted)" }} onClick={props.onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div role="tablist" aria-label="Measure by" className="seg inset" style={{ padding: 3, borderRadius: 12 }}>
        {(["portion", "pct", "exact"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={share.mode === m}
            style={{ height: 38, fontSize: 12 }}
            onClick={() => share.mode !== m && props.onChange(switchMode(m, props.currentMinor, props.totalMinor))}
          >
            {m === "portion" ? "Portions" : m === "pct" ? "Percent" : "Exact ₹"}
          </button>
        ))}
      </div>
      {chips.length > 0 ? (
        <div className="chips7">
          {chips.map((c) => (
            <button key={c.label} aria-pressed={share.value === c.value} onClick={() => props.onChange({ mode: share.mode, value: c.value })}>
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="exact-row">
          {EXACT_STEPS.slice(0, 2).map((d) => (
            <button key={d} aria-label={`${Math.abs(d) / 100} rupees less`} onClick={() => props.onChange({ mode: "exact", value: stepExact(share.value, d, props.totalMinor) })}>
              −{Math.abs(d) / 100}
            </button>
          ))}
          <span className="val">{formatShort(share.value, props.currency)}</span>
          {EXACT_STEPS.slice(2).map((d) => (
            <button key={d} aria-label={`${d / 100} rupees more`} onClick={() => props.onChange({ mode: "exact", value: stepExact(share.value, d, props.totalMinor) })}>
              +{d / 100}
            </button>
          ))}
        </div>
      )}
      <div className="stack" style={{ gap: 4, padding: "10px 12px", borderRadius: 12, background: "var(--surface)" }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>
          {props.name} pays <span className="money">{formatMoney(props.currentMinor, props.currency)}</span> of {formatShort(props.totalMinor, props.currency)}
        </span>
        <span className="small dim" style={{ lineHeight: 1.45 }}>{modeHint(share.mode, qty)}</span>
      </div>
      <div className="inline" style={{ flexWrap: "nowrap" }}>
        <button className="btn danger flex1" style={{ height: 44, fontSize: 13 }} onClick={() => { props.onChange(null); props.onClose(); }}>
          Take {props.name} off
        </button>
        <button className="btn flex1" style={{ height: 44, fontSize: 13 }} onClick={props.onClose}>Done</button>
      </div>
    </section>
  );
}

const SWITCH_TO = ["equal", "exact", "pct", "shares", "adjust"] as const;
const SWITCH_LABELS: Record<(typeof SWITCH_TO)[number], string> = { equal: "Equal", exact: "Exact", pct: "%", shares: "Shares", adjust: "±" };

const ADJ_KINDS: { kind: SplitecoAdjustmentKind; label: string }[] = [
  { kind: "tax", label: "Tax" },
  { kind: "service", label: "Service" },
  { kind: "discount", label: "Discount" },
];

function Adjustments({ ctx, subtotal }: { ctx: FormCtx; subtotal: number }) {
  const { form, setForm, currency } = ctx;
  const update = (key: string, fn: (a: AdjustmentForm) => AdjustmentForm) =>
    setForm((f) => ({ ...f, adjustments: f.adjustments.map((a) => (a.key === key ? fn(a) : a)) }));
  const add = (kind: SplitecoAdjustmentKind) =>
    setForm((f) => ({ ...f, adjustments: [...f.adjustments, { key: newKey("adj"), kind, label: "", mode: kind === "discount" ? "amount" : "pct", valueText: kind === "tax" ? "5" : kind === "service" ? "10" : "" }] }));
  const net = adjustmentsTotal(form);
  return (
    <section aria-label="Tax and discount" className="item" style={{ gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 500 }}>Tax, service &amp; discount</span>
      {form.adjustments.length === 0 ? <span className="small dim">None — add GST, a service charge or a discount below.</span> : null}
      {form.adjustments.map((a) => {
        const amount = adjustmentAmount(a, subtotal);
        return (
          <div key={a.key} className="stack s8" style={{ borderBottom: "1px solid var(--line-soft)", paddingBottom: 10 }}>
            <div className="row-between">
              <input
                aria-label="What the bill calls it"
                placeholder={a.kind === "tax" ? "GST" : a.kind === "service" ? "Service charge" : "Discount"}
                value={a.label}
                maxLength={60}
                onChange={(e) => update(a.key, (x) => ({ ...x, label: e.target.value }))}
                style={{ background: "transparent", border: 0, outline: "none", color: "var(--muted)", fontSize: 14, minWidth: 0, flex: 1 }}
              />
              <span className={a.kind === "discount" ? "okc" : ""} style={{ fontSize: 14 }}>
                {amount === null ? "—" : `${a.kind === "discount" ? "−" : ""}${formatMoney(amount, currency)}`}
              </span>
            </div>
            <div className="inline" style={{ flexWrap: "nowrap" }}>
              <div role="radiogroup" aria-label="Percent or amount" className="seg inset" style={{ padding: 3, flex: "none", width: 110 }}>
                <button role="radio" aria-checked={a.mode === "pct"} style={{ height: 38 }} onClick={() => update(a.key, (x) => ({ ...x, mode: "pct" }))}>%</button>
                <button role="radio" aria-checked={a.mode === "amount"} style={{ height: 38 }} onClick={() => update(a.key, (x) => ({ ...x, mode: "amount" }))}>₹</button>
              </div>
              <label className="amount-box" style={{ flex: 1 }}>
                <span>{a.mode === "pct" ? "%" : "₹"}</span>
                <input inputMode="decimal" aria-label={a.mode === "pct" ? "Percentage of the subtotal" : "Amount"} value={a.valueText} onChange={(e) => update(a.key, (x) => ({ ...x, valueText: e.target.value }))} style={{ width: "100%" }} />
              </label>
              <button className="iconbtn danger" aria-label="Remove this line" onClick={() => setForm((f) => ({ ...f, adjustments: f.adjustments.filter((x) => x.key !== a.key) }))}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          </div>
        );
      })}
      <div className="inline">
        {ADJ_KINDS.map((k) => (
          <button key={k.kind} className="chip" onClick={() => add(k.kind)} style={{ height: 44 }}>+ {k.label}</button>
        ))}
      </div>
      <span className="small dim">
        {net !== 0 ? `${net > 0 ? "Adds" : "Takes off"} ${formatMoney(Math.abs(net), currency)}. ` : ""}Spread by what each person had — a bigger plate pays a bigger share of the tax.
      </span>
    </section>
  );
}
