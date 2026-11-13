"use client";

import * as React from "react";
import { DECIDE_PX } from "../gestures";
import { sliderFires, sliderKeyFires, sliderPosition } from "../rules";
import { buzz, place, useLatest } from "./motion";

/** The knob's size and the gap around it inside the track (px), as on V2Settle. */
const KNOB_PX = 56;
const INSET_PX = 4;

/**
 * Slide to record (design §2, V2Settle): drag the knob along the track; let
 * go at 85% of the travel or more and `onFire` runs, else it springs back.
 * The twin is the keyboard: the knob is a focusable `role="slider"`, and
 * Enter or Space on it fires. Pointer events (mouse too: a slider is a
 * drag for everyone), with pointer capture taken only once the knob has
 * moved DECIDE_PX, so a stray tap does nothing.
 */
export function Slider({
  label,
  text,
  onFire,
  disabled = false,
  done = false,
}: {
  /** What a screen reader hears: "Slide to record the payment". */
  label: string;
  /** What the track says: "Slide to record". */
  text: string;
  onFire: () => void;
  disabled?: boolean;
  /** Fired already: the knob stays at the end. */
  done?: boolean;
}) {
  const track = React.useRef<HTMLDivElement | null>(null);
  const knob = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ id: number; x0: number; max: number; captured: boolean; x: number } | null>(null);
  const fire = useLatest(onFire);
  const [pct, setPct] = React.useState(0);

  const travel = () => Math.max(0, (track.current?.getBoundingClientRect().width ?? 0) - KNOB_PX - 2 * INSET_PX);

  React.useEffect(() => {
    const max = travel();
    place(knob.current, done ? max : 0, 0, true);
    setPct(done ? 100 : 0);
  }, [done]);

  const finish = () => {
    buzz(12);
    place(knob.current, travel(), 0, true);
    setPct(100);
    fire.current();
  };

  return (
    <div ref={track} className={`slider ${disabled ? "off" : ""}`} aria-disabled={disabled || undefined}>
      <span className="slider-text" aria-hidden="true">{text}</span>
      <div
        ref={knob}
        className="slider-knob"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled || done || !sliderKeyFires(e.key)) return;
          e.preventDefault();
          finish();
        }}
        onPointerDown={(e) => {
          if (disabled || done || (e.button ?? 0) !== 0) return;
          drag.current = { id: e.pointerId, x0: e.clientX, max: travel(), captured: false, x: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x0;
          if (!d.captured) {
            if (Math.abs(dx) < DECIDE_PX) return;
            d.captured = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Gone already: fine.
            }
          }
          d.x = sliderPosition(dx, d.max);
          place(knob.current, d.x, 0, false);
          setPct(d.max > 0 ? Math.round((d.x / d.max) * 100) : 0);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.id !== e.pointerId || !d.captured) return;
          if (sliderFires(d.x, d.max)) finish();
          else {
            place(knob.current, 0, 0, true);
            setPct(0);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          place(knob.current, 0, 0, true);
          setPct(0);
        }}
      >
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </div>
  );
}
