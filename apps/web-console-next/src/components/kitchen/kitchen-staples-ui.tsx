"use client";

import * as React from "react";
import { Check, ChevronDown, List as ListIcon, Plus, X } from "lucide-react";
import Link from "./link";
import type { KitchenStaple, StaplePantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44, K_TITLE } from "./kit";
import { RING } from "./new-home-parts-ui";
import { parseMinor } from "./money";
import type { MemberNames } from "./members";
import { SHOPPING_LIST_HREF, boughtToast, nextStatus, shoppingLabel, stapleChips, stapleSheet, stapleSub, type StockTone, type SwitcherOption } from "./kitchen-staples";
import type { FinishedRow } from "./restock";
import { useStapleActions } from "./kitchen-staples-data";

/**
 * The Kitchen's RV-21 parts (the canvas's RvKitchenB): the title that
 * switches pantries and its sheet, each pantry's Always have chips with
 * their sheet (Running low · Out · Got more, then the price and the equal
 * split), and the stock bar under a row's name.
 */

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[26px] border-x-0 bg-card px-4 pt-2 shadow-2xl focus:outline-none",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
  CLOSE_44,
);

/** The sheet's own close beside its title (the board's 44 px quiet ×); the sheet's corner × is hidden. */
const NO_CORNER_CLOSE = "[&>button:last-child]:hidden";

function InlineClose() {
  return (
    <SheetClose aria-label="Close" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-cp-line text-muted-foreground", RING)}>
      <X className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
    </SheetClose>
  );
}

function Grabber() {
  return <div aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />;
}

// ── The title switcher ────────────────────────────────────────────

export function PantrySwitcher({ title, options, onPick }: { title: string; options: readonly SwitcherOption[]; onPick: (key: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.on);
  return (
    <>
      <h1 className={cn(K_TITLE, "min-w-0 flex-1")}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${current && current.key !== "all" ? current.name : "Kitchen, all pantries"}, change pantry`}
          onClick={() => setOpen(true)}
          className={cn("flex min-h-11 max-w-full items-center gap-1 rounded-lg pr-1 text-left", RING)}
        >
          <span className="truncate">{title}</span>
          <ChevronDown className="mt-[3px] h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2.4} aria-hidden />
        </button>
      </h1>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, "px-2.5 pb-8")}>
          <Grabber />
          <SheetTitle className="mx-2 mb-1 mt-1.5 text-[17px] font-medium">Show</SheetTitle>
          <div className="flex flex-col gap-1.5">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                aria-pressed={o.on}
                onClick={() => {
                  setOpen(false);
                  onPick(o.key);
                }}
                className={cn("flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left", o.on ? "bg-cp-accent-tint" : "hover:bg-muted/50", RING)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-base font-medium">{o.key === "all" ? o.name : o.name}</span>
                  <span className="text-[13px] font-normal text-muted-foreground">{o.count}</span>
                </span>
                {o.soon > 0 ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-normal text-cp-soon">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-cp-soon" />
                    {o.soonText}
                  </span>
                ) : null}
                <span aria-hidden className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", o.on ? "bg-primary text-primary-foreground" : "text-transparent")}>
                  <Check className="h-[18px] w-[18px]" strokeWidth={2.6} />
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ── The stock bar ─────────────────────────────────────────────────

// The expired bar is RV-23's `cp-expired-bar` token, with the expired colour as its fallback until that lands.
const BAR_TONE: Record<StockTone, string> = { ok: "bg-primary", low: "bg-cp-soon", expired: "bg-[hsl(var(--cp-expired-bar,var(--cp-expired)))]" };

export function StockBar({ pct, tone, text }: { pct: number; tone: StockTone; text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="mt-1 block h-[3px] overflow-hidden rounded-sm bg-cp-line">
        <span className={cn("block h-[3px] rounded-sm", BAR_TONE[tone])} style={{ width: `${pct}%` }} />
      </span>
    </>
  );
}

// ── Always have ───────────────────────────────────────────────────

/** One pantry's Always have: its chips (a dot when running low or out), + Add, and the chip's sheet. */
export function StaplesCard({ pantry, meId, names, canEdit }: { pantry: StaplePantry; meId: string | null; names: MemberNames; canEdit: boolean }) {
  const actions = useStapleActions();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const name = pantry.owner.kind === "personal" ? "Mine" : pantry.owner.name;
  const chips = stapleChips(pantry);
  const staple = pantry.staples.find((s) => s.id === openId) ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-cp-card bg-card py-3 pl-3.5 pr-3 shadow-cp-card">
      <h3 className="text-[15px] font-medium">
        Always have <span className="font-normal text-muted-foreground">{stapleSub(pantry)}</span>
      </h3>
      <ul aria-label={`Always have, ${name}`} className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={c.label}
              disabled={!canEdit || c.id.startsWith("pending:")}
              onClick={() => setOpenId(c.id)}
              className={cn("flex min-h-11 items-center gap-[7px] rounded-full bg-cp-line px-3.5 text-[15px] font-normal text-foreground disabled:opacity-100", RING)}
            >
              {c.dot ? <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", c.dot === "out" ? "bg-cp-expired" : "bg-cp-soon")} /> : null}
              {c.name}
            </button>
          </li>
        ))}
        {canEdit ? (
          <li>
            <button
              type="button"
              aria-label={`Add to Always have, ${name}`}
              onClick={() => setAdding(true)}
              className={cn("flex min-h-11 items-center gap-1 rounded-full bg-cp-accent-tint pl-3 pr-3.5 text-[15px] font-medium text-cp-accent-text", RING)}
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              Add
            </button>
          </li>
        ) : null}
      </ul>
      <StapleSheetView
        pantry={pantry}
        staple={staple}
        meId={meId}
        names={names}
        onClose={() => setOpenId(null)}
        onStatus={(s, pressed) => {
          setOpenId(null);
          void actions.setStatus(pantry, s, nextStatus(s.status, pressed));
        }}
        onBought={(s, priceMinor, title) => {
          setOpenId(null);
          void actions.bought(pantry, s, priceMinor, title);
        }}
        onRemove={(s) => {
          setOpenId(null);
          void actions.remove(pantry, s);
        }}
      />
      <AddStapleSheet
        open={adding}
        pantryName={name}
        onClose={() => setAdding(false)}
        onAdd={(n) => {
          setAdding(false);
          void actions.add(pantry, n);
        }}
      />
    </div>
  );
}

function StapleSheetView({
  pantry,
  staple,
  meId,
  names,
  onClose,
  onStatus,
  onBought,
  onRemove,
}: {
  pantry: StaplePantry;
  staple: KitchenStaple | null;
  meId: string | null;
  names: MemberNames;
  onClose: () => void;
  onStatus: (s: KitchenStaple, pressed: "low" | "out") => void;
  onBought: (s: KitchenStaple, priceMinor: number, title: string) => void;
  onRemove: (s: KitchenStaple) => void;
}) {
  const [step, setStep] = React.useState<"menu" | "price">("menu");
  const [price, setPrice] = React.useState("");
  React.useEffect(() => {
    setStep("menu");
    setPrice("");
  }, [staple?.id]);
  const view = staple ? stapleSheet(staple, pantry, { typedMinor: price.trim() ? parseMinor(price) : null, meId, names }) : null;
  const post = () => {
    if (!staple || !view || view.priceMinor <= 0 && pantry.owner.kind === "group") return;
    onBought(staple, view.priceMinor, boughtToast(view, pantry));
  };
  const chip = (on: boolean, tone: string) => cn("min-h-[52px] rounded-2xl text-[15px] font-medium", on ? "bg-foreground text-background" : cn("bg-cp-line", tone), RING);
  return (
    <Sheet open={!!staple} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, NO_CORNER_CLOSE, "pb-8")}>
        <Grabber />
        {staple && view ? (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5">
                <SheetTitle className="text-[17px] font-medium">{view.name}</SheetTitle>
                <span className={cn("text-[13px] font-normal", view.subTone === "expired" ? "text-cp-expired" : view.subTone === "soon" ? "text-cp-soon" : "text-muted-foreground")}>{view.sub}</span>
              </div>
              <InlineClose />
            </div>
            {step === "menu" ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" aria-pressed={view.lowOn} onClick={() => onStatus(staple, "low")} className={chip(view.lowOn, "text-cp-soon")}>
                    Running low
                  </button>
                  <button type="button" aria-pressed={view.outOn} onClick={() => onStatus(staple, "out")} className={chip(view.outOn, "text-cp-expired")}>
                    Out
                  </button>
                  <button type="button" onClick={() => setStep("price")} className={cn("min-h-[52px] rounded-2xl bg-primary text-[15px] font-medium text-primary-foreground", RING)}>
                    Got more
                  </button>
                </div>
                <button type="button" onClick={() => onRemove(staple)} className={cn("min-h-11 rounded-xl text-sm font-medium text-muted-foreground", RING)}>
                  Remove from Always have
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2.5">
                <label htmlFor="staple-price" className="text-[13px] font-normal text-muted-foreground">
                  Price
                </label>
                <div className="-mt-1.5 flex min-h-14 items-center gap-1.5 rounded-2xl border border-border px-4 text-[22px] font-medium">
                  <span aria-hidden className="text-muted-foreground">
                    ₹
                  </span>
                  <input
                    id="staple-price"
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    autoFocus
                    value={price}
                    placeholder={view.pricePh}
                    onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") post();
                    }}
                    className="min-h-11 min-w-0 flex-1 bg-transparent text-[22px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <span className="text-sm font-normal text-muted-foreground">{view.splitLine}</span>
                <button
                  type="button"
                  onClick={post}
                  disabled={pantry.owner.kind === "group" && view.priceMinor <= 0}
                  className={cn("min-h-14 rounded-[18px] bg-primary text-[17px] font-medium text-primary-foreground disabled:opacity-50", RING)}
                >
                  {view.postLabel}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <SheetTitle className="sr-only">Always have</SheetTitle>
            <InlineClose />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AddStapleSheet({ open, pantryName, onClose, onAdd }: { open: boolean; pantryName: string; onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    if (!open) setName("");
  }, [open]);
  const go = () => {
    const n = name.trim();
    if (n) onAdd(n.charAt(0).toUpperCase() + n.slice(1));
  };
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, NO_CORNER_CLOSE, "pb-8")}>
        <Grabber />
        <div className="flex items-center gap-2.5">
          <SheetTitle className="flex min-h-11 min-w-0 flex-1 items-center text-[17px] font-medium">Add to Always have · {pantryName}</SheetTitle>
          <InlineClose />
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <label htmlFor="staple-name" className="sr-only">
            What do you always have?
          </label>
          <input
            id="staple-name"
            type="text"
            autoFocus
            value={name}
            maxLength={60}
            enterKeyHint="done"
            placeholder="Salt, tea, dish soap…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
            }}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-base font-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button type="button" onClick={go} className={cn("min-h-11 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground", RING)}>
            Add
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Finished this week, onto the list ─────────────────────────────

/**
 * Finished this week (RV-21, the board's): three rows, then See all; each "Add to list", then "On the list"
 * with a quiet Undo pill (RV-24) that takes it off again — shown where `onUndo` can (the line is on the list).
 */
export function FinishedToList({
  rows,
  listed,
  onAdd,
  onUndo,
}: {
  rows: readonly FinishedRow[];
  listed: (row: FinishedRow) => boolean;
  onAdd: (row: FinishedRow) => void;
  /** Takes the row's line off the list; null where it can't (it is listed by an Always have chip). */
  onUndo?: (row: FinishedRow) => (() => void) | null;
}) {
  const [all, setAll] = React.useState(false);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 3);
  return (
    <section aria-labelledby="pantry-finished" className="flex flex-col gap-2">
      <h2 id="pantry-finished" className="text-[17px] font-medium">
        Finished this week <span className="font-normal text-muted-foreground">· {rows.length}</span>
      </h2>
      <div className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
        <ul className="divide-y divide-cp-line">
          {shown.map((r) => {
            const on = listed(r);
            const undo = on && onUndo ? onUndo(r) : null;
            return (
              <li key={r.key} className="flex min-h-16 items-center gap-2.5 py-2 pl-3.5 pr-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className={cn("truncate text-base font-medium", on ? "text-foreground" : "text-muted-foreground")}>{r.name}</span>
                  <span className={cn("truncate text-[13px] font-normal", on ? "text-cp-accent-text" : "text-muted-foreground")}>{on ? "On the list" : r.sub}</span>
                </span>
                {on ? (
                  undo ? (
                    <button
                      type="button"
                      onClick={undo}
                      aria-label={`Take ${r.name} off the list`}
                      className={cn("min-h-11 shrink-0 rounded-[14px] px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted/50", RING)}
                    >
                      Undo
                    </button>
                  ) : null
                ) : r.canAdd ? (
                  <button
                    type="button"
                    onClick={() => onAdd(r)}
                    aria-label={`Add ${r.name} to the shopping list`}
                    className={cn("min-h-11 shrink-0 rounded-[14px] bg-cp-accent-tint px-3.5 text-sm font-medium text-cp-accent-text hover:bg-cp-accent-tint/80", RING)}
                  >
                    Add to list
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {rows.length > 3 ? (
          <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className={cn("min-h-12 w-full border-t border-cp-line text-sm font-medium text-cp-accent-text", RING, "focus-visible:ring-inset")}>
            {all ? "Show less" : `See all ${rows.length}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ── The header's shopping list ────────────────────────────────────

export function ShoppingListLink({ count }: { count: number }) {
  return (
    <Link
      href={SHOPPING_LIST_HREF}
      aria-label={shoppingLabel(count)}
      className={cn("relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card text-foreground shadow-cp-card", RING)}
    >
      <ListIcon className="h-5 w-5" strokeWidth={2} aria-hidden />
      {/* KC-7 (the canvas's Kitchen): the list as a round button, its count a badge on it. */}
      {count > 0 ? (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
