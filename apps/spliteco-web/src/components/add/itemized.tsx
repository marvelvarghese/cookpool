"use client";

import * as React from "react";
import type { SplitecoAdjustmentKind, SplitecoItemShareMode } from "@saas/contracts/spliteco";
import { owedBySplit } from "@saas/kitchen-engine/splits";
import { Icon } from "../icons";
import { Avatar, BackButton, Sheet } from "../ui";
import { usePager } from "@saas/gestures/react/pager";
import { useHold } from "@saas/gestures/react/hold";
import { useRepeat } from "@saas/gestures/react/repeat";
import { formatMoney, formatShort } from "../../lib/money";
import { nameOf, tintOf } from "../../lib/people";
import {
  adjustmentAmount,
  adjustmentsTotal,
  emptyItem,
  itemTotal,
  itemsSubtotal,
  newKey,
  splitInput,
  toSpec,
  totalOf,
  type AdjustmentForm,
  type ItemForm,
  type ItemShareForm,
} from "../../lib/split-form";
import {
  DEFAULT_SHARE,
  FACE_EXACT_STEP,
  FACE_PCT_CHIPS,
  FACE_PORTION_CHIPS,
  everyone,
  faceBadge,
  itemAmounts,
  itemStatus,
  personTotals,
  qtyLine,
  resetItem,
  setShare,
  splitEvenly,
  stepExact,
  switchMode,
} from "../../lib/itemized";
import { addEveryone, peopleOn, sameAsLast } from "../../lib/item-people";
import { clampIndex, indexAfterRemove, itemHasProblem } from "../../lib/carousel";
import type { FormCtx } from "./types";

interface Props {
  ctx: FormCtx;
  title: string;
  groupName: string;
  onBack: () => void;
  onSave: () => void;
  canSave: boolean;
  /** "Save", or what is missing ("2 items left to assign"). */
  saveLabel: string;
  busy: boolean;
  error: string | null;
  /** SE4: open this bill as a live split, so people at the table claim their own items. */
  onLive?: () => void;
  liveBusy?: boolean;
}

type Open = { kind: "who" } | { kind: "face"; who: string } | { kind: "item" } | { kind: "adjustments" } | null;

/**
 * Itemized (V2Itemized): one card per item, swiped between (the dots are the
 * twin); the faces on it with their share; + opens Who had it?; tapping or
 * holding a face opens how much they had. Each person's total and Save sit
 * at the bottom; Save says how many items are left.
 */
export function ItemizedView({ ctx, title, groupName, onBack, onSave, canSave, saveLabel, busy, error, onLive, liveBusy }: Props) {
  const { form, setForm, names, me, currency } = ctx;
  const [current, setCurrent] = React.useState(0);
  const [open, setOpen] = React.useState<Open>(null);
  const count = form.items.length;
  const cur = clampIndex(current, count);
  const go = React.useCallback((i: number) => setCurrent(i), []);
  const pager = usePager({ index: cur, count: Math.max(1, count), onChange: go, leaveEdge: true });
  const bill = totalOf(form) ?? 0;
  const owed = count > 0 ? owedBySplit(Math.max(0, bill), toSpec(splitInput(form))) : null;
  const owedBy = owed?.ok ? new Map(owed.value.breakdown.map((b) => [b.subjectId, b.owedMinor])) : null;
  const totals = personTotals(form, owedBy);
  const item = form.items[cur];
  const updateItem = (key: string, fn: (it: ItemForm) => ItemForm) => setForm((f) => ({ ...f, items: f.items.map((it) => (it.key === key ? fn(it) : it)) }));
  const addItem = () => {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
    setCurrent(count);
    setOpen({ kind: "item" });
  };
  const net = adjustmentsTotal(form);

  return (
    <div className="page iz" style={{ padding: 0 }}>
      <header className="hdr">
        <BackButton label="Back to the expense" onClick={onBack} />
        <div className="hdr-title" style={{ flex: 1 }}>
          <input
            className="iz-title"
            aria-label="What for?"
            placeholder="What for?"
            maxLength={200}
            value={title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <span>{groupName}</span>
        </div>
        <span className="money" style={{ fontSize: 17, fontWeight: 600 }}>{formatShort(bill, currency)}</span>
      </header>

      {count > 1 ? (
        <div role="tablist" aria-label="Items" className="iz-dots">
          {form.items.map((it, i) => {
            const bad = itemHasProblem(it, form.members);
            return (
              <button
                key={it.key}
                role="tab"
                aria-selected={i === cur}
                aria-label={`${it.name || `Item ${i + 1}`}${bad ? ", not fully assigned" : ""}`}
                className={`${i === cur ? "on" : ""} ${bad ? "bad" : ""}`}
                onClick={() => go(i)}
              />
            );
          })}
        </div>
      ) : null}

      {count > 0 ? (
        <div className="pager iz-pager" ref={pager.viewport}>
          <div className="pager-track" ref={pager.track}>
            {form.items.map((it, index) => (
              <div key={it.key} className="iz-page">
                <ItemCard
                  item={it}
                  index={index}
                  ctx={ctx}
                  onWho={() => {
                    go(index);
                    setOpen({ kind: "who" });
                  }}
                  onFace={(who) => {
                    go(index);
                    setOpen({ kind: "face", who });
                  }}
                  onMenu={() => {
                    go(index);
                    setOpen({ kind: "item" });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty">No items yet.</p>
      )}

      <div className="iz-actions">
        <button className="add-chip" onClick={addItem}>
          <Icon name="plus" size={16} /> Item
        </button>
        <button className="add-chip" onClick={() => setOpen({ kind: "adjustments" })} aria-label="Tax, service and discount">
          Adjustments{net !== 0 ? ` · ${net > 0 ? "+" : "−"}${formatShort(Math.abs(net), currency)}` : ""}
        </button>
        {onLive ? (
          <button className="add-chip" onClick={onLive} disabled={liveBusy} aria-label="Split live: everyone at the table claims their own items" style={{ color: "var(--ok)" }}>
            <Icon name="live" size={16} /> {liveBusy ? "Opening…" : "Live"}
          </button>
        ) : null}
      </div>

      <div className="iz-bottom">
        <div className="iz-totals" aria-label="Each person's total">
          {totals.map((t) => (
            <div key={t.subjectId} className="t">
              <Avatar id={t.subjectId} name={nameOf(names, t.subjectId, me)} me={me} size={30} />
              <span>{formatShort(t.minor, currency)}</span>
            </div>
          ))}
          {totals.length === 0 ? <span className="small dim">Tap + on an item to say who had it</span> : null}
        </div>
        {error ? <p className="error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
        <button className="btn big round" onClick={onSave} disabled={!canSave || busy}>{saveLabel}</button>
      </div>

      {open?.kind === "who" && item ? (
        <Sheet label={`Who had ${item.name || "it"}`} onClose={() => setOpen(null)}>
          <div className="row-between">
            <h2 className="h1" style={{ fontSize: 20 }}>Who had it?</h2>
            <button className="add-chip" onClick={() => updateItem(item.key, (it) => addEveryone(it, form.members))}>Everyone</button>
          </div>
          {cur > 0 ? (
            <button className="add-chip" style={{ alignSelf: "flex-start" }} onClick={() => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === cur ? (sameAsLast(f.items, cur, f.members) ?? it) : it)) }))}>
              Same as last item
            </button>
          ) : null}
          <div className="iz-pick">
            {form.members.map((m) => {
              const on = !!item.shares[m];
              const name = nameOf(names, m, me);
              return (
                <button key={m} aria-pressed={on} aria-label={name} className={on ? "on" : ""} style={on ? { background: tintOf(m, me).bg } : undefined} onClick={() => updateItem(item.key, (it) => setShare(it, m, on ? null : { ...DEFAULT_SHARE }))}>
                  <Avatar id={m} name={name} me={me} size={34} />
                  <span className="ellipsis">{name}</span>
                </button>
              );
            })}
          </div>
          <button className="btn big" onClick={() => setOpen(null)}>Done</button>
        </Sheet>
      ) : null}

      {open?.kind === "face" && item && item.shares[open.who] ? (
        <FaceSheet
          item={item}
          who={open.who}
          name={nameOf(names, open.who, me)}
          ctx={ctx}
          onChange={(share) => updateItem(item.key, (it) => setShare(it, open.who, share))}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open?.kind === "item" && item ? (
        <Sheet label={item.name || `Item ${cur + 1}`} onClose={() => setOpen(null)}>
          <h2 className="h1" style={{ fontSize: 20 }}>Item {cur + 1} of {count}</h2>
          <label className="field">
            <span className="sr">Item name</span>
            <input placeholder="Item name" value={item.name} maxLength={120} onChange={(e) => updateItem(item.key, (it) => ({ ...it, name: e.target.value }))} />
          </label>
          <div className="iz-fields">
            <label><span>Qty</span><input aria-label="Quantity" inputMode="decimal" value={item.qtyText} onChange={(e) => updateItem(item.key, (it) => ({ ...it, qtyText: e.target.value }))} /></label>
            <label><span>Each</span><input aria-label="Price of one" inputMode="decimal" placeholder="—" value={item.unitText} onChange={(e) => updateItem(item.key, (it) => ({ ...it, unitText: e.target.value }))} /></label>
            <label><span>Total</span><input aria-label="Line total" inputMode="decimal" placeholder={itemTotal(item) !== null && !item.totalText ? String((itemTotal(item) ?? 0) / 100) : "total"} value={item.totalText} onChange={(e) => updateItem(item.key, (it) => ({ ...it, totalText: e.target.value }))} /></label>
          </div>
          <div className="menu4">
            <button onClick={() => updateItem(item.key, (it) => everyone(it, form.members))}>Everyone</button>
            <button onClick={() => updateItem(item.key, splitEvenly)}>Split evenly</button>
            <button onClick={() => updateItem(item.key, resetItem)}>Reset</button>
            <button
              className="del"
              onClick={() => {
                setForm((f) => ({ ...f, items: f.items.filter((it) => it.key !== item.key) }));
                setCurrent(indexAfterRemove(cur, cur, count - 1));
                setOpen(null);
              }}
            >
              Remove item
            </button>
          </div>
          <button className="btn big" onClick={() => setOpen(null)}>Done</button>
        </Sheet>
      ) : null}

      {open?.kind === "adjustments" ? (
        <Sheet label="Tax, service and discount" onClose={() => setOpen(null)}>
          <Adjustments ctx={ctx} subtotal={itemsSubtotal(form)} />
          <button className="btn big" onClick={() => setOpen(null)}>Done</button>
        </Sheet>
      ) : null}
    </div>
  );
}

function ItemCard({ item, index, ctx, onWho, onFace, onMenu }: { item: ItemForm; index: number; ctx: FormCtx; onWho: () => void; onFace: (who: string) => void; onMenu: () => void }) {
  const { form, names, me, currency } = ctx;
  const total = itemTotal(item);
  const status = itemStatus(item, form.members, currency);
  const { amounts } = itemAmounts(item, form.members);
  const label = item.name || `Item ${index + 1}`;
  return (
    <article className={`iz-card ${status.tone === "bad" ? "bad" : ""}`} aria-label={label}>
      <div className="iz-card-head">
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <span className="small dim">{qtyLine(item, currency)}</span>
          <div className="iz-name">
            <span className="ellipsis">{label}</span>
            <span className="money">{total === null ? "—" : formatShort(total, currency)}</span>
          </div>
        </div>
        <button className="add-round" aria-label={`Change ${label}`} onClick={onMenu}>
          <Icon name="more" size={18} />
        </button>
      </div>
      <div className="iz-faces">
        {peopleOn(item, form.members).map((id) => (
          <Face key={id} id={id} name={nameOf(names, id, me)} me={me} share={item.shares[id]} amount={formatShort(amounts.get(id) ?? 0, currency)} onOpen={() => onFace(id)} />
        ))}
        <button className="iz-add" aria-label={`Who had ${label}? Add people`} onClick={onWho}>+</button>
      </div>
      {status.tone === "bad" ? <span className="iz-gap">{status.text}</span> : null}
    </article>
  );
}

function Face({ id, name, me, share, amount, onOpen }: { id: string; name: string; me: string | null; share: ItemShareForm | undefined; amount: string; onOpen: () => void }) {
  const hold = useHold(onOpen);
  const badge = faceBadge(share);
  return (
    <button className="iz-face" style={{ background: tintOf(id, me).bg }} aria-label={`${name} ${amount}${badge ? ` (${badge})` : ""} — tap or hold to adjust`} {...hold} onClick={onOpen}>
      <Avatar id={id} name={name} me={me} size={38} />
      <span className="s">{amount}</span>
      {badge ? <span className="bdg">{badge}</span> : null}
    </button>
  );
}

function FaceSheet({ item, who, name, ctx, onChange, onClose }: { item: ItemForm; who: string; name: string; ctx: FormCtx; onChange: (s: ItemShareForm | null) => void; onClose: () => void }) {
  const { form, setForm, me, currency } = ctx;
  const share = item.shares[who]!;
  const total = itemTotal(item) ?? 0;
  const current = itemAmounts(item, form.members).amounts.get(who) ?? 0;
  // Held, the ₹ − / + keeps stepping from the latest value, not the one it was pressed on.
  const step = (d: number) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => {
        const s = it.key === item.key ? it.shares[who] : undefined;
        return s ? setShare(it, who, { mode: "exact", value: stepExact(s.value, d, itemTotal(it) ?? 0) }) : it;
      }),
    }));
  const less = useRepeat(() => step(-FACE_EXACT_STEP), 80);
  const more = useRepeat(() => step(FACE_EXACT_STEP), 80);
  const chips = share.mode === "portion" ? FACE_PORTION_CHIPS : share.mode === "pct" ? FACE_PCT_CHIPS : [];
  return (
    <Sheet label={`Adjust ${name}`} onClose={onClose}>
      <div className="sheet-person">
        <Avatar id={who} name={name} me={me} size={40} />
        <span className="name">{name}</span>
        <span className="amt money">{formatShort(current, currency)}</span>
      </div>
      <div role="tablist" aria-label="Measure by" className="seg inset">
        {(["portion", "pct", "exact"] as const).map((m: SplitecoItemShareMode) => (
          <button key={m} role="tab" aria-selected={share.mode === m} onClick={() => share.mode !== m && onChange(switchMode(m, current, total))}>
            {m === "portion" ? "Portions" : m === "pct" ? "%" : "₹"}
          </button>
        ))}
      </div>
      {chips.length > 0 ? (
        <div className="iz-chips">
          {chips.map((c) => (
            <button key={c.label} aria-pressed={share.value === c.value} onClick={() => onChange({ mode: share.mode, value: c.value })}>
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="iz-exact">
          <button aria-label="Less — hold to repeat" {...less}>−</button>
          <span>{formatShort(share.value, currency)}</span>
          <button aria-label="More — hold to repeat" {...more}>+</button>
        </div>
      )}
      <button
        className="btn danger"
        onClick={() => {
          onChange(null);
          onClose();
        }}
      >
        Remove from item
      </button>
    </Sheet>
  );
}

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
    <section aria-label="Tax and discount" className="stack" style={{ gap: 10 }}>
      <h2 className="h1" style={{ fontSize: 20 }}>Tax, service &amp; discount</h2>
      {form.adjustments.length === 0 ? <span className="small dim">None yet.</span> : null}
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
        {net !== 0 ? `${net > 0 ? "Adds" : "Takes off"} ${formatMoney(Math.abs(net), currency)}. ` : ""}Spread by what each person had.
      </span>
    </section>
  );
}
