"use client";

import * as React from "react";
import type { SplitecoSplitMethod } from "@saas/contracts/spliteco";
import { Icon } from "../icons";
import { Avatar } from "../ui";
import { useSheetDrag } from "@saas/gestures/react/sheet-drag";
import { useRepeat } from "@saas/gestures/react/repeat";
import { settleTransition, useLatest } from "@saas/gestures/react/motion";
import { listenForDrags } from "@saas/gestures/gestures";
import { CLICK_GUARD_MS } from "@saas/gestures/row-gestures";
import { isSideways } from "@saas/gestures/rules";
import { currencySymbol, moneyInput } from "../../lib/money";
import {
  AMOUNT,
  METHODS,
  METHOD_LINES,
  METHOD_PILLS,
  PILL_STEP,
  amountShown,
  chooseMethod,
  fieldOf,
  footerOf,
  isSelected,
  itemsLeft,
  itemsLeftText,
  keyFromKeyboard,
  keypadKeys,
  keypadLive,
  pressKey,
  rowsOf,
  selectionFor,
  stepShares,
  stripRelease,
  toggleIn,
  type Key,
  type Row,
  type Selected,
} from "../../lib/add-split";
import { enteredItems, totalOf } from "../../lib/split-form";
import type { FormCtx } from "./types";

interface Props {
  ctx: FormCtx;
  sel: Selected;
  setSel: (s: Selected) => void;
  /** Drag down (or ✕): back, without saving. */
  onClose: () => void;
  /** A sheet is open over Add: the hardware keyboard is the sheet's. */
  keysOff: boolean;
  head: React.ReactNode;
  chips: React.ReactNode;
  onItems: () => void;
  save: React.ReactNode;
}

/**
 * Add, keypad first (V2Add; design §0.5, §4). The amount, what for, who paid,
 * the method strip, one row per person with how their share is set and a
 * footer that says what is left, then the one keypad and Save. The keypad
 * types into whatever is selected (the amount, or a person's field); the
 * hardware keyboard does the same while focus is not in a text input.
 */
export function AddSheet({ ctx, sel: chosen, setSel, onClose, keysOff, head, chips, onItems, save }: Props) {
  const { form, setForm, names, me, currency } = ctx;
  const drag = useSheetDrag(onClose);
  // A person picked under one method types into the amount under another.
  const sel: Selected = chosen.kind === "person" && (!fieldOf(form.method) || !form.members.includes(chosen.id)) ? AMOUNT : chosen;
  const isItems = form.method === "items";
  const total = totalOf(form) ?? 0;
  const live = keypadLive(form, sel);
  const press = (k: Key) => setForm((f) => pressKey(f, sel, k));
  const pick = (m: SplitecoSplitMethod) => {
    setForm((f) => chooseMethod(f, m));
    setSel(selectionFor(m, form.members));
  };
  const rows = isItems ? [] : rowsOf(form, names, me, currency);
  const foot = footerOf(form, names, me, currency);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (keysOff || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
    const k = keyFromKeyboard(e.key);
    if (!k || !live) return;
    if (k === "±" && !(sel.kind === "person" && form.method === "adjust")) return;
    e.preventDefault();
    press(k);
  };

  return (
    <div className="add-sheet" ref={drag.sheet} onKeyDown={onKeyDown}>
      <div className="grabber" aria-hidden="true" />
      {head}

      <div className="add-top">
        <button
          className={`add-amt ${isSelected(sel, "amount") && live ? "on" : ""} ${total > 0 ? "set" : ""}`}
          aria-label={`Amount, ${currencySymbol(currency).trim()}${amountShown(isItems ? moneyInput(total) : form.amountText, currency)}${isItems ? " — the items' total" : " — tap to type it"}`}
          aria-pressed={isSelected(sel, "amount")}
          onClick={() => setSel(AMOUNT)}
          onFocus={() => setSel(AMOUNT)}
        >
          <span className="sym">{currencySymbol(currency).trim()}</span>
          <span className="fig">{isItems ? amountShown(moneyInput(total), currency) : amountShown(form.amountText, currency)}</span>
          {isSelected(sel, "amount") && live ? <span className="caret big" aria-hidden="true" /> : null}
        </button>
        <input
          className="add-title"
          aria-label="What for?"
          placeholder="What for?"
          maxLength={200}
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
      </div>
      {chips}

      <MethodStrip method={form.method} onPick={pick} />
      <span className="add-hint">{METHOD_LINES[form.method]}</span>

      {isItems ? (
        <button className="add-items" onClick={onItems}>
          <span aria-hidden="true" style={{ fontSize: 26 }}>🧾</span>
          {enteredItems(form) > 0
            ? `${form.items.length} item${form.items.length === 1 ? "" : "s"} · ${itemsLeft(form) ? itemsLeftText(itemsLeft(form)) : "all assigned"} →`
            : "Add the items →"}
        </button>
      ) : (
        <section className="add-card" aria-label="Each person's share">
          <div className="add-rows" role="list">
            {rows.map((r) => (
              <PersonRow key={r.id} row={r} ctx={ctx} selected={isSelected(sel, r.id)} onSelect={() => setSel({ kind: "person", id: r.id })} />
            ))}
          </div>
          <div className="add-foot" aria-live="polite">
            <span className="dim">{foot.left}</span>
            <span className={foot.ok ? "okc" : "owe"} style={{ fontWeight: 500 }}>{foot.right}</span>
          </div>
        </section>
      )}

      <div className={`keypad ${live ? "" : "off"}`} role="group" aria-label="Keypad">
        {keypadKeys(form, sel).map((k) => (
          <button
            key={k.key}
            className={k.key === "del" || k.key === "." || k.key === "±" ? "soft" : ""}
            aria-label={k.aria}
            disabled={!live}
            // The selected field keeps the focus, so the hardware keyboard keeps typing there.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => press(k.key)}
          >
            {k.label}
          </button>
        ))}
      </div>
      {save}
    </div>
  );
}

function PersonRow({ row, ctx, selected, onSelect }: { row: Row; ctx: FormCtx; selected: boolean; onSelect: () => void }) {
  const { setForm, me } = ctx;
  const less = useRepeat(() => setForm((f) => stepShares(f, row.id, -1)));
  const more = useRepeat(() => setForm((f) => stepShares(f, row.id, 1)));
  return (
    <div role="listitem" className={`add-row ${row.dim ? "dim" : ""}`}>
      <Avatar id={row.id} name={row.name} me={me} size={30} />
      <span className="n ellipsis">{row.name}</span>
      <span className={`comes ${row.control === "field" ? "soft" : ""}`}>{row.comes}</span>
      {row.control === "tick" ? (
        <button
          className={`tick ${row.on ? "on" : ""}`}
          aria-label={row.aria}
          aria-pressed={row.on}
          onClick={() => setForm((f) => toggleIn(f, row.id))}
        >
          {row.on ? <Icon name="check" size={16} stroke={2.6} /> : null}
        </button>
      ) : row.control === "step" ? (
        <span className="step">
          <button aria-label={`One share less for ${row.name} — hold to repeat`} {...less}>−</button>
          <span aria-label={`${row.name}: ${row.shares} shares`}>{row.shares}</span>
          <button aria-label={`One share more for ${row.name} — hold to repeat`} {...more}>+</button>
        </span>
      ) : (
        <button
          className={`kfield ${selected ? "on" : ""} ${row.empty ? "empty" : ""} ${row.tone}`}
          aria-label={`${row.aria}: ${row.pre}${row.field}${row.post}`}
          aria-pressed={selected}
          onClick={onSelect}
          onFocus={onSelect}
        >
          {row.pre ? <span className="affix">{row.pre}</span> : null}
          {row.field}
          {row.post ? <span className="affix">{row.post}</span> : null}
          {selected ? <span className="caret" aria-hidden="true" /> : null}
        </button>
      )}
    </div>
  );
}

/** The strip's track: pill `i` centred, moved `dx` by a finger (pills are PILL_STEP − 8 wide, 8 apart). */
function at(i: number, dx: number): string {
  return `translate3d(${-(PILL_STEP / 2 - 4) - i * PILL_STEP + dx}px, 0, 0)`;
}

/**
 * The six methods as pills; the chosen one sits in the middle. It swipes
 * sideways (one pill per PILL_STEP px, or one on a flick) and every pill
 * taps — the twin.
 */
function MethodStrip({ method, onPick }: { method: SplitecoSplitMethod; onPick: (m: SplitecoSplitMethod) => void }) {
  const index = Math.max(0, METHODS.indexOf(method));
  const [viewport, setViewport] = React.useState<HTMLElement | null>(null);
  const [track, setTrack] = React.useState<HTMLElement | null>(null);
  const liveState = useLatest({ index, onPick });
  // The first placement is instant (an edit opens on its method without sliding there).
  const placed = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!track) return;
    track.style.transition = settleTransition(placed.current === track);
    placed.current = track;
    track.style.transform = at(index, 0);
  }, [track, index]);

  React.useEffect(() => {
    if (!viewport || !track) return;
    let guardUntil = -Infinity;
    const stop = listenForDrags(viewport, {
      begin: () => (dx, dy) => isSideways(dx, dy),
      move(dx) {
        track.style.transition = "none";
        track.style.transform = at(liveState.current.index, dx);
      },
      end(drag, cancelled) {
        guardUntil = performance.now() + CLICK_GUARD_MS;
        const { index: i, onPick: change } = liveState.current;
        const next = cancelled ? i : stripRelease(i, drag.dx, drag.vx);
        track.style.transition = settleTransition(true);
        track.style.transform = at(next, 0);
        if (next !== i) change(METHODS[next]!);
      },
    });
    const onClick = (e: Event) => {
      if (performance.now() > guardUntil) return;
      guardUntil = -Infinity;
      e.preventDefault();
      e.stopPropagation();
    };
    viewport.addEventListener("click", onClick, true);
    // Focusing a pill scrolls an overflow-hidden box to show it, which would
    // throw the track off centre; the track's transform does the placing.
    const unscroll = () => {
      if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    };
    viewport.addEventListener("scroll", unscroll);
    return () => {
      stop();
      viewport.removeEventListener("click", onClick, true);
      viewport.removeEventListener("scroll", unscroll);
    };
  }, [viewport, track, liveState]);

  return (
    <div className="mstrip" ref={setViewport} role="tablist" aria-label="Split method — swipe or tap">
      <div className="mstrip-track" ref={setTrack}>
        {METHODS.map((m) => (
          <button key={m} role="tab" aria-selected={m === method} onClick={() => onPick(m)}>
            {METHOD_PILLS[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

