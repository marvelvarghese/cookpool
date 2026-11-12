"use client";

import * as React from "react";
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Plus, ReceiptText, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "./data";
import { KCard, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { RING } from "./new-home-parts-ui";
import { useBack } from "./back-ui";
import { useMemberNames, useMyRoles } from "./people-data";
import { useStaples } from "./kitchen-staples-data";
import { cleanTyped } from "./tick-row";
import { memberInitials, memberLabelInline } from "./members";
import { readingText } from "./receipt-run";
import { ReceiptCapture, ReceiptProblem, ReceiptReading } from "./receipt-scan-ui";
import { useReceiptScan } from "./receipt-scan-flow";
import { extraRow, runStartRows, runView, type RowEdit, type RunRow, type RunRowView, type RunSection } from "./list-run";
import { readGot } from "./shopping-list-data";
import { useListRunSave, useRunCategories } from "./list-run-data";
import { nameKeyOf } from "./restock";

/**
 * The shopping run from the list (cookpool-revamp RV-22, the board
 * RvShoppingRun), `/pantry/run?from=list`: "Shopping run · 6", **Scan the
 * receipt** (AI-8's read; hidden when AI isn't there), then the rows ticked
 * on the list by where they go — "Flat 4B · split equally" for a group's
 * Always have, "· by use" for its pantry, Mine — each with its amount and ₹
 * price (last time's in grey), the name opening where it goes; once read,
 * the receipt's card with its one question (Include in item costs? Yes/No)
 * and "Also on the receipt"; **+ Add something else**; Paid by; and **Add
 * to kitchen · ₹1,240**, with Undo. Pure parts in list-run.ts; the write in
 * list-run-data.ts.
 */
export function ListRun() {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  const staples = useStaples();
  const { roles } = useMyRoles();
  const close = useBack();
  const save = useListRunSave();
  const scan = useReceiptScan();
  const [got] = React.useState(() => (typeof window === "undefined" ? [] : readGot()));
  const [edits, setEdits] = React.useState<Readonly<Record<string, RowEdit>>>({});
  const [extras, setExtras] = React.useState<RunRow[]>([]);
  const [removed, setRemoved] = React.useState<ReadonlySet<string>>(new Set());
  const [adjustIn, setAdjustIn] = React.useState(true);
  const [payer, setPayer] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<{ key: string; what: "dest" | "unit" } | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const idemKey = React.useRef(crypto.randomUUID());
  // The rows are taken once from the first read, so saving (which clears the list) doesn't empty the screen.
  const [start, setStart] = React.useState<RunRow[] | null>(null);
  if (start === null && staples.data) setStart(runStartRows(staples.data, got));

  const pantries = React.useMemo(
    () => (staples.data?.pantries ?? []).filter((p) => p.owner.kind === "personal" || roles.get(p.owner.orgId) !== "viewer"),
    [staples.data, roles],
  );
  const categories = useRunCategories(start ?? []);
  const rows = React.useMemo(() => (start ?? []).map((r) => ({ ...r, category: r.category ?? categories[nameKeyOf(r.name)] ?? null })), [start, categories]);
  const receipt = scan.read && scan.phase === "result" ? scan.read : null;
  const view = runView({ rows, extras, receipt, edits, removed, adjustIn, pantries, meId, names, payer });
  const edit = (key: string, e: RowEdit) => setEdits((x) => ({ ...x, [key]: { ...x[key], ...e } }));

  const addExtra = () => {
    const name = draft.trim();
    setDraft("");
    setAdding(false);
    if (name) setExtras((x) => [...x, extraRow(name.slice(0, 60), x.length)]);
  };
  const finish = () => {
    if (!view.plan) return;
    void save(view.plan, { title: view.toast, idempotencyKey: idemKey.current });
    idemKey.current = crypto.randomUUID();
    close();
  };

  if (scan.phase === "capture") return <ReceiptCapture onPhoto={scan.take} onClose={scan.reset} problem={scan.captureProblem} />;
  if (scan.phase === "reading") {
    return (
      <div className="pb-4 min-[900px]:max-w-[640px]">
        <ReceiptReading photoUrl={scan.photoUrl} text={readingText(scan.found)} onCancel={scan.cancel} />
      </div>
    );
  }
  if (scan.phase === "problem" && scan.error) {
    return (
      <div className="pb-4 min-[900px]:max-w-[640px]">
        <ReceiptProblem photoUrl={scan.photoUrl} error={scan.error} onRetake={scan.retake} onByHand={scan.reset} />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4 min-[900px]:max-w-[640px]">
      <header className="-ml-2 flex items-center gap-1.5">
        <button type="button" onClick={close} aria-label="Back to Shopping list" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-foreground", RING)}>
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden />
        </button>
        <h1 className={cn(K_TITLE, "min-w-0 flex-1")}>
          Shopping run <span className="font-normal text-muted-foreground">· {view.count}</span>
        </h1>
      </header>

      {view.receipt ? (
        <KCard className="overflow-hidden">
          <div className="flex min-h-16 items-center gap-3 py-2 pl-3.5 pr-2">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-cp-accent-tint text-cp-accent-text">
              <ReceiptText className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-base font-medium">{view.receipt.title}</span>
              <span className="truncate text-[13px] font-normal text-muted-foreground">{view.receipt.fact}</span>
            </span>
            <button type="button" onClick={scan.open} className={cn("min-h-11 rounded-[14px] px-3 text-sm font-medium text-cp-accent-text", RING)}>
              Retake
            </button>
          </div>
          {view.receipt.asks ? (
            <div role="group" aria-labelledby="adj-q" className="flex flex-col gap-2 border-t border-cp-line py-2.5 pl-3.5 pr-2.5">
              <span className="text-[13px] font-normal text-muted-foreground">{view.receipt.adjust}</span>
              <div className="flex items-center gap-2.5">
                <span id="adj-q" className="min-w-0 flex-1 text-[15px] font-medium">
                  Include in item costs?
                </span>
                <div className="flex gap-1 rounded-[14px] bg-cp-line p-[3px]">
                  {([true, false] as const).map((yes) => (
                    <button
                      key={String(yes)}
                      type="button"
                      aria-pressed={adjustIn === yes}
                      onClick={() => setAdjustIn(yes)}
                      className={cn(
                        "min-h-10 min-w-[52px] rounded-[11px] px-3.5 text-sm font-medium",
                        adjustIn === yes ? "bg-card text-foreground shadow-cp-card" : "bg-transparent text-muted-foreground",
                        RING,
                      )}
                    >
                      {yes ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </KCard>
      ) : scan.shows ? (
        <button
          type="button"
          onClick={scan.open}
          className={cn("flex min-h-[76px] w-full items-center gap-3 rounded-cp-card bg-card px-3.5 py-3 text-left text-foreground shadow-cp-card", RING)}
        >
          <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cp-accent-tint text-cp-accent-text">
            <Camera className="h-6 w-6" strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base font-medium">Scan the receipt</span>
            <span className="text-[13px] font-normal text-muted-foreground">Fills prices and adds anything else you got</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden />
        </button>
      ) : null}

      {start === null ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[136px] w-full rounded-cp-card" />
        </div>
      ) : view.count === 0 ? (
        <KCard className="p-4">
          <p className="text-[15px] font-normal text-muted-foreground">Nothing ticked on the list</p>
        </KCard>
      ) : (
        view.sections.map((s) => (
          <RunSectionView
            key={s.key}
            section={s}
            open={open}
            onOpen={(key, what) => setOpen((o) => (o && o.key === key && o.what === what ? null : { key, what }))}
            onEdit={(key, e) => {
              edit(key, e);
              if (e.dest || e.unit) setOpen(null);
            }}
            onRemove={(key) => setRemoved((x) => new Set([...x, key]))}
          />
        ))
      )}

      {adding ? (
        <div className="flex min-h-16 items-center gap-2.5 rounded-cp-card bg-card py-2 pl-3.5 pr-2.5 shadow-cp-card">
          <label htmlFor="run-add" className="sr-only">
            Something else you got
          </label>
          <input
            id="run-add"
            type="text"
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
            maxLength={60}
            value={draft}
            placeholder="What else did you get?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addExtra();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-base font-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button type="button" aria-label="Add it" onClick={addExtra} className={cn("grid h-11 w-12 shrink-0 place-items-center rounded-xl bg-cp-accent-tint text-cp-accent-text", RING)}>
            <ArrowRight className="h-5 w-5" strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn("flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-cp-card bg-card text-[15px] font-medium text-cp-accent-text shadow-cp-card", RING)}
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden />
          Add something else
        </button>
      )}

      {/* Paid by and the one main button, in thumb reach, at the screen's bottom (no tab bar here). */}
      <div
        data-toast-above=""
        className="sticky bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem))] z-30 -mx-4 flex flex-col gap-2.5 bg-gradient-to-t from-background from-[78%] to-transparent px-4 pb-1 pt-7 min-[900px]:static min-[900px]:mx-0 min-[900px]:max-w-sm min-[900px]:bg-none min-[900px]:px-0 min-[900px]:pt-0"
      >
        {view.payers.length > 1 ? (
          <div role="group" aria-labelledby="paid-h" className="flex items-center gap-2">
            <span id="paid-h" className="flex-1 text-[15px] font-medium">
              Paid by
            </span>
            {view.payers.map((id) => {
              const on = id === view.payer;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Paid by ${memberLabelInline(id, meId, names)}`}
                  onClick={() => setPayer(id)}
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 text-[15px] font-medium",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-transparent bg-card text-foreground shadow-cp-card",
                    RING,
                  )}
                >
                  {id === meId ? "Y" : memberInitials(id, meId, names)}
                </button>
              );
            })}
          </div>
        ) : null}
        {view.problem ? <p className="text-center text-[13px] font-normal text-muted-foreground">{view.problem}</p> : null}
        <Button
          type="button"
          onClick={finish}
          disabled={!view.plan}
          className={cn(MAIN_BUTTON, !view.plan && "bg-muted text-muted-foreground disabled:opacity-100", "shadow-cp-nav min-[900px]:shadow-none")}
        >
          <MainButtonLabel title={view.mainLabel} />
        </Button>
      </div>
    </div>
  );
}

function RunSectionView({
  section,
  open,
  onOpen,
  onEdit,
  onRemove,
}: {
  section: RunSection;
  open: { key: string; what: "dest" | "unit" } | null;
  onOpen: (key: string, what: "dest" | "unit") => void;
  onEdit: (key: string, e: RowEdit) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <section aria-label={`${section.title} ${section.sub}`.trim()} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className={K_SECTION}>
          {section.title} {section.sub ? <span className="font-normal text-muted-foreground">{section.sub}</span> : null}
        </h2>
        <span className="text-[13px] font-normal text-muted-foreground">{section.total}</span>
      </div>
      <div className={K_ROWS}>
        {section.rows.map((r) => (
          <RunRowLine key={r.key} row={r} open={open?.key === r.key ? open.what : null} onOpen={(what) => onOpen(r.key, what)} onEdit={(e) => onEdit(r.key, e)} onRemove={() => onRemove(r.key)} />
        ))}
      </div>
    </section>
  );
}

const BOX = "flex min-h-11 items-center rounded-xl border focus-within:ring-2 focus-within:ring-ring";

function RunRowLine({
  row,
  open,
  onOpen,
  onEdit,
  onRemove,
}: {
  row: RunRowView;
  open: "dest" | "unit" | null;
  onOpen: (what: "dest" | "unit") => void;
  onEdit: (e: RowEdit) => void;
  onRemove: () => void;
}) {
  const chipsId = React.useId();
  const units = open === "unit" && row.units.length > 1;
  return (
    <div>
      <div className={cn("grid min-h-[66px] items-center gap-1.5 py-2 pl-3.5", row.removable ? "grid-cols-[minmax(0,1fr)_88px_76px_40px] pr-1" : "grid-cols-[minmax(0,1fr)_88px_76px] pr-3")}>
        <button
          type="button"
          aria-expanded={open === "dest"}
          aria-controls={open === "dest" ? chipsId : undefined}
          aria-label={`${row.name}${row.matched ? ", on the receipt" : ""}, goes to ${row.choices.find((c) => c.on)?.label ?? row.chip}, change`}
          onClick={() => onOpen("dest")}
          className={cn("flex min-h-12 min-w-0 flex-col items-start justify-center gap-[3px] rounded-lg text-left text-foreground", RING)}
        >
          <span className="flex min-w-0 max-w-full items-center gap-[5px]">
            <span className="truncate text-base font-medium">{row.name}</span>
            {row.matched ? <Check className="h-4 w-4 shrink-0 text-cp-accent-text" strokeWidth={2.8} aria-hidden /> : null}
          </span>
          <span className="flex max-w-full items-center gap-1.5 whitespace-nowrap">
            <span className="flex shrink-0 items-center gap-px rounded-full bg-cp-line py-px pl-2 pr-1 text-xs font-medium text-foreground">
              {row.chip}
              <ChevronDown className="h-3 w-3" strokeWidth={2.4} aria-hidden />
            </span>
            {row.note ? <span className="truncate text-xs font-normal text-muted-foreground">{row.note}</span> : null}
          </span>
        </button>
        <div className={cn(BOX, "gap-0.5 pl-2 pr-0.5", row.qtyInvalid ? "border-cp-expired" : "border-border")}>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Amount of ${row.name}, ${row.unit}`}
            aria-invalid={row.qtyInvalid || undefined}
            value={row.qty}
            placeholder={row.qtyGhost}
            onChange={(e) => onEdit({ qty: cleanTyped(e.target.value) })}
            className="w-full min-w-0 bg-transparent text-right text-base font-medium tabular-nums text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-expanded={units}
            aria-label={`Unit: ${row.unit}, change`}
            disabled={row.units.length < 2}
            onClick={() => onOpen("unit")}
            className={cn("flex min-h-8 shrink-0 items-center gap-px rounded-md pl-[3px] pr-0.5 text-[13px] font-normal text-muted-foreground disabled:cursor-default", RING)}
          >
            {row.unit}
            {row.units.length > 1 ? <ChevronDown className="h-[11px] w-[11px]" strokeWidth={2.4} aria-hidden /> : null}
          </button>
        </div>
        <div className={cn(BOX, "gap-0.5 px-2", row.matched ? "border-transparent bg-cp-accent-tint" : "border-border")}>
          <span aria-hidden className="text-[15px] font-normal text-muted-foreground">
            ₹
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Price of ${row.name}, rupees${!row.matched && row.priceGhost !== "0" ? `, last time ${row.priceGhost}` : ""}`}
            value={row.price}
            placeholder={row.priceGhost}
            onChange={(e) => onEdit({ price: e.target.value.replace(/[^0-9.]/g, "").slice(0, 10) })}
            className="w-full min-w-0 bg-transparent text-right text-base font-medium tabular-nums text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
          />
        </div>
        {row.removable ? (
          <button type="button" aria-label={`Remove ${row.name}`} onClick={onRemove} className={cn("grid h-11 w-10 place-items-center rounded-xl text-muted-foreground", RING)}>
            <X className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          </button>
        ) : null}
      </div>
      {open === "dest" || units ? (
        <div id={chipsId} role="group" aria-label={units ? `Unit for ${row.name}` : `Where ${row.name} goes`} className="flex flex-wrap gap-1.5 px-3.5 pb-3">
          {(units
            ? row.units.map((u) => ({ id: u, label: u, on: u === row.unit, pick: () => onEdit({ unit: u, qty: "" }) }))
            : row.choices.map((c) => ({ id: c.id, label: c.label, on: c.on, pick: () => onEdit({ dest: c.dest }) }))
          ).map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.on}
              onClick={c.pick}
              className={cn(
                "min-h-11 rounded-full px-3.5 text-sm font-medium",
                c.on ? "bg-primary text-primary-foreground" : "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80",
                RING,
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
