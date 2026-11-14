"use client";

// Money-native MY-20: the one set of numbers behind every Money sheet (boards
// Money_AddGroup, Money_AddGroupFrom, Money_PickSpliteco, Group_Waste). A sheet
// is the shared Radix sheet (focus trap, Esc, drag to close) dressed with the
// boards' pixels; colours are the `look` tokens, so dark follows Cookpool's.

import * as React from "react";
import { look, lookVars } from "@saas/spliteco-ui/look";
import { MOTION } from "@saas/spliteco-ui/motion";
import { cn } from "@/lib/cn";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** The boards' measurements in px, pinned by tests. */
export const SHEET = {
  radius: 28,
  padding: "10px 20px",
  paddingBottom: 32,
  gap: 16,
  handle: { width: 40, height: 4 },
  titleRow: 36,
  title: 22,
  hit: 44,
  scrim: "rgba(27,36,32,.42)",
  field: 52,
  fieldRadius: 16,
  search: 48,
  cardRadius: 20,
  radioRow: 64,
  radioDot: 22,
  startRow: 56,
  groupRow: 64,
  avatar: 36,
  actionRow: 52,
  button: 52,
  buttonRadius: 12,
  smallButton: 36,
  smallButtonRadius: 10,
} as const;

/** What every sheet control shares: the console's focus ring, no outline. */
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Grows a 36px control's tap area to 44px without moving a pixel. */
export const HIT_44 = "relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";

const font = { fontFamily: "inherit" } as const;

export const sectionLabelStyle: React.CSSProperties = { margin: 0, padding: "0 2px", fontSize: 13, fontWeight: 500, color: look.muted };

export function SectionLabel({ children, id }: { children: React.ReactNode; id?: string | undefined }) {
  return (
    <h3 id={id} style={sectionLabelStyle}>
      {children}
    </h3>
  );
}

/** A labelled block: the label, 8px, then the control. */
export function Section({ label, children, labelId }: { label?: string | undefined; children: React.ReactNode; labelId?: string | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {label ? <SectionLabel id={labelId}>{label}</SectionLabel> : null}
      {children}
    </div>
  );
}

/** White card, 20px corners; rows inside it are divided by a 1px line. */
export function Card({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} style={{ background: look.surface, borderRadius: SHEET.cardRadius, overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}

export const divider = (i: number): React.CSSProperties => (i === 0 ? {} : { borderTop: `1px solid ${look.line}` });

export const chevronRight = (
  <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const chevronDown = (
  <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** The bottom sheet: bg token, 28px top corners, 10/20/32 padding, 16 gap, the board's scrim. */
export function BoardSheet({ open, onOpenChange, label, children }: { open: boolean; onOpenChange: (open: boolean) => void; label: string; children: React.ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        bareClose
        aria-label={label}
        aria-describedby={undefined}
        data-look="cookpool"
        data-board-sheet=""
        scrimClassName="bg-[rgba(27,36,32,.42)]"
        scrimStyle={{ animationDuration: `${MOTION.dimMs}ms`, animationTimingFunction: "ease" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn("mx-auto max-h-[94dvh] max-w-xl gap-4 overflow-hidden rounded-t-[28px] border-0 shadow-none min-[900px]:bottom-6 min-[900px]:rounded-[28px]")}
        style={{
          ...lookVars("cookpool"),
          background: look.bg,
          color: look.ink,
          padding: SHEET.padding,
          paddingBottom: `calc(${SHEET.paddingBottom}px + env(safe-area-inset-bottom))`,
          fontFamily: "inherit",
          // The boards set no line-height (normal); the console's body sets 1.5.
          lineHeight: "normal",
          fontVariantNumeric: "tabular-nums",
          // The sheet rises over the product's one geometry time and curve (MY-22); the dim fades in over its own.
          animationDuration: `${MOTION.geometryMs}ms`,
          animationTimingFunction: MOTION.ease,
        }}
      >
        <span aria-hidden data-handle="" className="min-[900px]:hidden" style={{ alignSelf: "center", flex: "none", width: SHEET.handle.width, height: SHEET.handle.height, borderRadius: 2, background: look.grab }} />
        {children}
      </SheetContent>
    </Sheet>
  );
}

const closeX = (
  <svg aria-hidden width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2} strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const backArrow = (
  <svg aria-hidden width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

/** Title row, 36px: the title (22/500) with a 44px Close at the right, or a 44px Back at the left. */
export function SheetTitleRow({ title, onBack }: { title: string; onBack?: () => void }) {
  const hit: React.CSSProperties = { width: SHEET.hit, height: SHEET.hit, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer", borderRadius: "50%" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: SHEET.titleRow, flex: "none" }}>
      {onBack ? (
        <button type="button" aria-label="Back" onClick={onBack} className={FOCUS} style={{ ...hit, marginLeft: -10 }}>
          {backArrow}
        </button>
      ) : null}
      <SheetTitle style={{ margin: 0, fontSize: SHEET.title, fontWeight: 500, letterSpacing: "-0.01em", flex: 1, lineHeight: "normal" }}>{title}</SheetTitle>
      {onBack ? null : (
        <SheetClose aria-label="Close" className={FOCUS} style={{ ...hit, marginRight: -10 }}>
          {closeX}
        </SheetClose>
      )}
    </div>
  );
}

/** A 52px field on the surface colour: radius 16, 16px text, 16px inset. */
export const fieldStyle: React.CSSProperties = { ...font, width: "100%", height: SHEET.field, border: 0, borderRadius: SHEET.fieldRadius, background: look.surface, color: look.ink, fontSize: 16, padding: "0 16px", boxSizing: "border-box" };

/** A radio row: a 22px dot (6px green ring when chosen, 2px grab ring when not), label 15/500 and hint 13 muted. */
export function RadioRow({ checked, first, name, value, label, hint, onSelect }: { checked: boolean; first: boolean; name: string; value: string; label: string; hint?: string; onSelect: () => void }) {
  return (
    <label
      data-radio-row=""
      data-checked={checked ? "true" : "false"}
      className="has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring"
      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: SHEET.radioRow, padding: "10px 16px", cursor: "pointer", boxSizing: "border-box", background: checked ? look.soft : "transparent", ...divider(first ? 0 : 1) }}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      <span aria-hidden data-dot="" style={{ width: SHEET.radioDot, height: SHEET.radioDot, borderRadius: "50%", boxSizing: "border-box", flex: "none", background: look.surface, border: checked ? `6px solid ${look.primary}` : `2px solid ${look.grab}` }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>
        {hint ? <span style={{ fontSize: 13, color: look.muted }}>{hint}</span> : null}
      </span>
    </label>
  );
}

/** The primary action: 52px, radius 12, label at the left, a chevron at the right. */
export const PrimaryAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }>(function PrimaryAction({ children, busy, disabled, style, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(FOCUS, "focus-visible:ring-offset-2 focus-visible:ring-offset-background", className)}
      style={{ ...font, flex: "none", display: "flex", alignItems: "center", gap: 10, height: SHEET.button, padding: "0 20px", border: 0, borderRadius: SHEET.buttonRadius, background: look.primary, color: look.onPrimary, fontSize: 15, fontWeight: 500, cursor: disabled || busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, textAlign: "left", ...style }}
    >
      <span style={{ flex: 1 }}>{children}</span>
      <svg aria-hidden width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={look.onPrimary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
});

/** The small tinted button (Copy): 36px, radius 10, soft tint. */
export const smallButtonStyle: React.CSSProperties = { ...font, height: SHEET.smallButton, padding: "0 14px", borderRadius: SHEET.smallButtonRadius, border: 0, background: look.soft, color: look.softInk, fontSize: 14, fontWeight: 500 };
