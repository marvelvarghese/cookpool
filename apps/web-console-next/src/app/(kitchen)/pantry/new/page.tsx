"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { addFormName } from "@/components/kitchen/say-it";
import { History } from "lucide-react";
import type { KitchenItem, Pantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_INPUT } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { Chip } from "@/components/kitchen/ledger-ui";
import { memberLabel } from "@/components/kitchen/members";
import { currencyPrefix } from "@/components/kitchen/money";
import { canManageGroup, roleFromKitchen } from "@/components/kitchen/groups";
import { useMemberNames, useMyRoles } from "@/components/kitchen/people-data";
import { useAddItem, useKitchenItem, useMembersOf, usePantries } from "@/components/kitchen/pantry-data";
import { MAIN_BUTTON, MainButtonLabel } from "@/components/kitchen/faces-ui";
import { NoteField } from "@/components/kitchen/item-note-ui";
import { newFrame } from "@/lib/features";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { fromBeforeTerm, historyFill, historySuggestion, shownSuggestions } from "@/components/kitchen/from-before";
import { useItemHistory } from "@/components/kitchen/from-before-data";
import { SuggestionList, useTypeahead } from "@/components/kitchen/from-before-ui";
import { ALL_PANTRIES, PERSONAL_PANTRY, dayMonth, orderPantries, pantryChipLabel, pantryKey, parsePantryParam } from "@/components/kitchen/pantry";
import {
  FILLED_FROM_BEFORE,
  ITEM_CATEGORIES,
  ITEM_NAME_MAX,
  MAIN_UNITS,
  MORE_UNITS,
  USE_BY_CHOICES,
  addMainLabel,
  boughtSections,
  chipWindow,
  firstItemError,
  initialItemForm,
  localIsoDay,
  previewItemForm,
  useByChoice,
  useByFor,
  wasteOptions,
  wastePick,
  wasteShown,
  type BoughtSection,
  type ItemField,
  type ItemForm,
} from "@/components/kitchen/item-form";
import { useKitchenRouter } from "@/components/kitchen/transition-ui";
import { NEW_ASK_DRAFT, addItemAskFields, askDraftOf, showsAddItemAsk, type AskDraft } from "@/components/kitchen/ask-before-use";
import { AskSettingFields } from "@/components/kitchen/ask-ui";
import { addFormFrom, historyEntryOfItem } from "@/components/kitchen/restock";

/**
 * Bought (CP-12; SM-15 under the seven rules, the canvas's "Bought from
 * before"): **where it goes first** — your own pantry or a group you add to,
 * as one row of chips — since it changes the form; then what, how much and
 * the price (the price per kg and per 100 g as numbers once both read), its
 * category; for a group, who paid and who pays if it goes to waste (two
 * choices, the group's rule on to start); when to use it by (3 days · 5 days
 * · 2 wks · None · a date) and, quietly, when it was bought. One main button
 * names it: "Add Milk · ₹68.00 / to Flat 4B". Adding charges nobody; the
 * toast can undo it for ten seconds.
 *
 * From before (SM-9): as the name is typed, what was bought before shows
 * under it ("Milk · 1 L · Flat 4B · 6× · ₹68"; the most recent on an empty
 * field). Picking one fills the form from last time — "Filled from last time
 * · change anything" — and moves to Add, so buying milk again is: type "mi",
 * tap Milk, tap Add.
 *
 * In the new frame (RC-3) an optional Note sits under the details: one line,
 * at most 80 characters, and who will see it — "Only you see it" in your own
 * pantry, "Everyone in Flat 4B sees it" in a group's. A pick from before
 * keeps what is typed there.
 *
 * Also in the new frame (cookpool-pantry PN-6), `?from=me:itm_…` — Bought
 * again's Change — opens the form filled from that item, as a pick from
 * before would fill it ("Filled from last time"), with you as the payer.
 */
export default function AddItemPage() {
  const searchParams = useSearchParams();
  const profile = useProfile();
  const pantries = usePantries();
  const { roles, loading: rolesLoading } = useMyRoles();
  const meId = profile.data?.id ?? null;

  // Groups you only view take no items: the picker leaves them out.
  const writable = React.useMemo(
    () => (pantries.data ?? []).filter((p) => p.kind === "personal" || roles.get(p.orgId) !== "viewer"),
    [pantries.data, roles],
  );
  const asked = parsePantryParam(searchParams?.get("pantry"));
  // `?from=` fills the form from an item (PN-6), in the new frame only; one that can't be read leaves it empty.
  const fromRef = React.useMemo(() => addFormFrom(searchParams?.get("from"), newFrame()), [searchParams]);
  const from = useKitchenItem(fromRef);
  const fromWaiting = fromRef !== null && from.loading;

  if (pantries.loading || profile.loading || rolesLoading || fromWaiting) return <AddItemSkeleton />;
  if (pantries.error || !pantries.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your pantries. {pantries.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={pantries.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const start = asked !== ALL_PANTRIES && writable.some((p) => pantryKey(p) === asked) ? asked : PERSONAL_PANTRY;
  const viewerOnly = asked !== ALL_PANTRIES && asked !== PERSONAL_PANTRY && start === PERSONAL_PANTRY
    ? (pantries.data.find((p) => pantryKey(p) === asked) ?? null)
    : null;
  // `?name=` (Say what you used's Add it, cookpool-ai AI-7) fills the name, in the new frame only.
  const name = addFormName(searchParams?.get("name"), newFrame());
  return <AddItemForm pantries={writable} start={start} meId={meId} viewerOf={viewerOnly} from={fromRef ? from.data : null} name={name} />;
}

function AddItemForm({
  pantries,
  start,
  meId,
  viewerOf,
  from = null,
  name = null,
}: {
  pantries: readonly Pantry[];
  start: string;
  meId: string | null;
  /** The group the link asked for, when you only view it (the item goes to your own pantry instead). */
  viewerOf: Pantry | null;
  /** The item `?from=` names (PN-6): the form starts filled from it. */
  from?: KitchenItem | null;
  /** The name `?name=` gives (AI-7's Add it), when the form isn't filled from an item. */
  name?: string | null;
}) {
  const router = useKitchenRouter();
  const recentSlugs = useRecentGroupSlugs();
  const today = React.useMemo(() => localIsoDay(new Date()), []);
  // The new frame's Note (RC-3); the page is read in the browser, so the host decides once.
  const notes = React.useMemo(() => newFrame(), []);
  // Filled from `?from=`'s item the way a pick from before fills it, once.
  const [startFill] = React.useState(() =>
    from ? historyFill(historyEntryOfItem(from, meId), initialItemForm({ today, pantry: start, meId }), { today, pantries, fallbackPantry: start, meId }) : null,
  );
  const [form, setForm] = React.useState<ItemForm>(() => startFill?.form ?? { ...initialItemForm({ today, pantry: start, meId }), ...(name ? { name } : {}) });
  const [moreUnits, setMoreUnits] = React.useState(() => startFill?.moreUnits ?? MORE_UNITS.includes(form.unit));
  const [morePayers, setMorePayers] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [serverFields, setServerFields] = React.useState<Partial<Record<ItemField, string>>>({});
  // "Filled from last time" shows from a pick until the name changes; the dates open on demand.
  const [filled, setFilled] = React.useState(startFill !== null);
  const [dateOpen, setDateOpen] = React.useState(false);
  const [boughtOpen, setBoughtOpen] = React.useState(false);
  // One key per item being added: a retry after a lost answer adds it once.
  const idemKey = React.useRef(crypto.randomUUID());
  const nameFieldRef = React.useRef<HTMLDivElement>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);
  // Filled from an item: the next tap is Add, as after a pick.
  React.useEffect(() => {
    if (startFill) window.requestAnimationFrame(() => addRef.current?.focus());
  }, [startFill]);

  // From before: names bought before, as the name is typed (the most recent on an empty field).
  const typeahead = useTypeahead(form.name, "item-name-suggestions");
  const history = useItemHistory(typeahead.term, typeahead.open || typeahead.term === "");
  const fresh = !history.isPlaceholderData && typeahead.term === fromBeforeTerm(form.name);
  const suggestions = typeahead.open ? shownSuggestions(history.data, form.name, fresh) : [];
  const pickSuggestion = (index: number) => {
    const entry = suggestions[index];
    if (!entry) return;
    const fill = historyFill(entry, form, { today, pantries, fallbackPantry: start, meId });
    setServerFields({});
    setServerError(null);
    setMorePayers(false);
    if (fill.moreUnits) setMoreUnits(true);
    setForm(fill.form);
    setFilled(true);
    setDateOpen(false);
    typeahead.close();
    // Everything stays editable; the next tap is Add.
    window.requestAnimationFrame(() => addRef.current?.focus());
  };

  const ordered = React.useMemo(() => orderPantries(pantries, recentSlugs), [pantries, recentSlugs]);
  const chosen = pantries.find((p) => pantryKey(p) === form.pantry) ?? pantries.find((p) => p.kind === "personal") ?? null;
  const group = chosen?.kind === "group" ? chosen : null;
  // Reads the chosen pantry's list ahead, so the item is listed there the moment it is added.
  const addItem = useAddItem(chosen ? pantryKey(chosen) : null);
  const members = useMembersOf(group?.orgId ?? null);
  const names = useMemberNames(members.data);
  const currency = chosen?.currency ?? "INR";
  const prefix = currencyPrefix(currency);
  const preview = previewItemForm(form, { today, currency, meId });
  const update = (patch: Partial<ItemForm>) => {
    setServerFields({});
    setForm((f) => ({ ...f, ...patch }));
  };
  const err = (field: ItemField) => serverFields[field] ?? (showErrors ? preview.errors[field] : undefined);

  // The payer must be in the chosen group: anyone else falls back to you.
  React.useEffect(() => {
    if (!members.data) return;
    if (!form.paidBy || !members.data.some((m) => m.subjectId === form.paidBy)) {
      setForm((f) => ({ ...f, paidBy: meId }));
    }
  }, [members.data, form.paidBy, meId]);

  const roster = React.useMemo(() => (members.data ?? []).map((m) => m.subjectId), [members.data]);
  const payerChips = chipWindow(roster, { meId, names, chosen: form.paidBy ? [form.paidBy] : [], expanded: morePayers, max: 5 });
  const myRole = roleFromKitchen(members.data?.find((m) => m.subjectId === meId)?.role);
  // Who can use it (cookpool-pantry PN-9, design §8.1): a group item you pay for, in the new frame.
  const [askDraft, setAskDraft] = React.useState<AskDraft>(() => (from?.askFirst ? askDraftOf(from) : NEW_ASK_DRAFT));
  const showAsk = notes && showsAddItemAsk({ group: group !== null, paidBy: form.paidBy, meId });

  // Added at once (SM-5): the item is listed in its pantry, the toast is up
  // (Undo for whoever paid for it, or an owner or admin — the API's rule) and
  // the pantry opens, before the server answers; a refusal takes the row off
  // and the toast says why.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    setServerError(null);
    const request = preview.request;
    if (!request) {
      const first = firstItemError(preview.errors);
      if (first === "expiresOn") setDateOpen(true);
      if (first === "boughtOn") setBoughtOpen(true);
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-field="${first}"] :is(input, textarea, button)`)?.focus(),
      );
      return;
    }
    setBusy(true);
    const paidBy = request.kind === "group" ? (request.body.paidBy ?? meId) : meId;
    void addItem({
      request:
        showAsk && request.kind === "group"
          ? { ...request, body: { ...request.body, ...addItemAskFields(askDraft, { group: true, paidBy, meId, roster: members.data ? roster : null }) } }
          : request,
      pantry: group ? { kind: "group", orgId: group.orgId, slug: group.slug, name: group.name } : { kind: "personal", name: chosen?.name ?? "Personal" },
      currency,
      groupWastePolicy: group ? group.wastePolicy : null,
      meId,
      names,
      today,
      where: group ? group.name : "your pantry",
      canRemove: !group || paidBy === meId || canManageGroup(myRole),
      idempotencyKey: idemKey.current,
    });
    idemKey.current = crypto.randomUUID();
    router.push(`/pantry?pantry=${encodeURIComponent(group ? group.orgId : PERSONAL_PANTRY)}`);
  };

  const wastes = group ? wasteOptions({ paidBy: form.paidBy, meId, names }) : [];
  const wasteOn = group ? wasteShown(form.waste, group.wastePolicy) : null;
  const useBy = useByChoice(form);
  const main = addMainLabel({ name: form.name, priceMinor: preview.priceMinor, currency, pantryName: group ? group.name : null });

  const sections: Record<BoughtSection, React.ReactNode> = {
    pantry: (
      <fieldset key="pantry">
        <legend className={LEGEND}>Put it in</legend>
        <div className="flex flex-wrap gap-2">
          {ordered.map((p) => {
            const key = pantryKey(p);
            const on = chosen ? pantryKey(chosen) === key : key === PERSONAL_PANTRY;
            return (
              <Chip
                key={key}
                aria-pressed={on}
                selected={on}
                onClick={() => {
                  setMorePayers(false);
                  update({ pantry: key });
                }}
              >
                {pantryChipLabel(p)}
              </Chip>
            );
          })}
        </div>
        {viewerOf && viewerOf.kind === "group" ? <p className="mt-2 text-[13px] text-muted-foreground">You only view {viewerOf.name}.</p> : null}
      </fieldset>
    ),
    name: (
      <div key="name" className="space-y-2" data-field="name">
        <div ref={nameFieldRef} className="space-y-2">
          <Label htmlFor="item-name" className={LEGEND}>
            What?
          </Label>
          <Input
            id="item-name"
            value={form.name}
            {...typeahead.inputProps({
              count: suggestions.length,
              onPick: pickSuggestion,
              onChange: (e) => {
                setFilled(false);
                update({ name: e.target.value });
              },
            })}
            placeholder="Milk, eggs, rice…"
            maxLength={ITEM_NAME_MAX}
            autoComplete="off"
            autoFocus={startFill === null}
            aria-invalid={!!err("name")}
            aria-describedby={err("name") ? "item-name-error" : undefined}
            className={cn(K_INPUT, "h-[52px] text-[17px] font-bold sm:h-[52px]")}
          />
        </div>
        <FieldError id="item-name-error" message={err("name")} />
        <SuggestionList
          id="item-name-suggestions"
          label="From before"
          views={suggestions.map(historySuggestion)}
          active={typeahead.active}
          onPick={pickSuggestion}
          onHighlight={typeahead.highlight}
          fieldRef={nameFieldRef}
        />
        {filled ? (
          <p className="flex items-center gap-2 rounded-xl bg-cp-herb-tint px-3 py-2.5 text-[13px] font-bold text-[#165C3A]">
            <History className="h-4 w-4 shrink-0" aria-hidden />
            {FILLED_FROM_BEFORE}
          </p>
        ) : null}
      </div>
    ),
    amount: (
      <div key="amount" className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2" data-field="quantity">
            <Label htmlFor="item-qty" className={LEGEND}>
              How much
            </Label>
            <Input
              id="item-qty"
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => update({ quantity: e.target.value })}
              placeholder="1"
              autoComplete="off"
              aria-invalid={!!err("quantity")}
              aria-describedby={err("quantity") ? "item-qty-error" : preview.perUnit ? "item-unit-line" : undefined}
              className={cn(K_INPUT, "h-12 tabular-nums sm:h-12")}
            />
          </div>
          <div className="space-y-2" data-field="price">
            <Label htmlFor="item-price" className={LEGEND}>
              Price
            </Label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                {prefix}
              </span>
              <Input
                id="item-price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => update({ price: e.target.value })}
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={!!err("price")}
                aria-describedby={err("price") ? "item-price-error" : preview.perUnit ? "item-unit-line" : undefined}
                className={cn(K_INPUT, "h-12 tabular-nums sm:h-12", prefix.length > 1 ? "pl-14" : "pl-8")}
              />
            </div>
          </div>
        </div>
        <FieldError id="item-qty-error" message={err("quantity")} />
        <FieldError id="item-price-error" message={err("price")} />
        <div role="group" aria-label="Unit" className="flex flex-wrap gap-2">
          {[...MAIN_UNITS, ...(moreUnits ? MORE_UNITS : [])].map((u) => (
            <Chip key={u} aria-pressed={form.unit === u} selected={form.unit === u} onClick={() => update({ unit: u })} className="min-w-12 justify-center px-3">
              {u}
            </Chip>
          ))}
          {moreUnits ? null : (
            <Chip onClick={() => setMoreUnits(true)} className="px-3 text-muted-foreground">
              more
            </Chip>
          )}
        </div>
        {/* Numbers only, once they read (no "Enter a quantity and price…" before). */}
        {preview.perUnit ? (
          <p id="item-unit-line" role="status" aria-live="polite" className="text-sm font-bold tabular-nums text-primary">
            {preview.perUnit}
          </p>
        ) : null}
      </div>
    ),
    category: (
      <fieldset key="category" data-field="category" aria-describedby={err("category") ? "item-category-error" : undefined}>
        <legend className={LEGEND}>Category</legend>
        <div className="flex flex-wrap gap-2">
          {ITEM_CATEGORIES.map((c) => (
            <Chip key={c.id} aria-pressed={form.category === c.id} selected={form.category === c.id} onClick={() => update({ category: c.id })}>
              {c.label}
            </Chip>
          ))}
        </div>
        <FieldError id="item-category-error" message={err("category")} />
      </fieldset>
    ),
    paidBy: (
      <fieldset key="paidBy" data-field="paidBy">
        <legend className={LEGEND}>Who paid?</legend>
        {members.loading ? (
          <div className="flex gap-2" aria-hidden>
            <Skeleton className="h-11 w-20 rounded-full" />
            <Skeleton className="h-11 w-24 rounded-full" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(payerChips.shown.length > 0 ? payerChips.shown : meId ? [meId] : []).map((id) => (
              <Chip key={id} aria-pressed={form.paidBy === id} selected={form.paidBy === id} onClick={() => update({ paidBy: id })}>
                {memberLabel(id, meId, names)}
              </Chip>
            ))}
            {payerChips.more > 0 ? (
              <Chip onClick={() => setMorePayers(true)} className="text-muted-foreground">
                {payerChips.more} more
              </Chip>
            ) : null}
          </div>
        )}
        <FieldError id="item-payer-error" message={err("paidBy")} />
      </fieldset>
    ),
    waste: group ? (
      <fieldset key="waste">
        <legend className={LEGEND}>If it goes to waste</legend>
        <div className="grid grid-cols-2 gap-2">
          {wastes.map((w) => (
            <Chip
              key={w.id}
              aria-pressed={wasteOn === w.id}
              selected={wasteOn === w.id}
              onClick={() => update({ waste: wastePick(w.id, group.wastePolicy) })}
              className="justify-center px-3"
            >
              {w.label}
            </Chip>
          ))}
        </div>
      </fieldset>
    ) : null,
    useBy: (
      <fieldset key="useBy" data-field="expiresOn" className="space-y-2">
        <legend className={cn(LEGEND, "mb-0")}>Use by</legend>
        <div className="flex flex-wrap gap-2">
          {USE_BY_CHOICES.map((c) => {
            const on = c.id === "date" ? useBy === "date" || dateOpen : useBy === c.id && !dateOpen;
            return (
              <Chip
                key={c.id}
                aria-pressed={on}
                selected={on}
                className="px-3.5"
                onClick={() => {
                  if (c.id === "date") {
                    setDateOpen(true);
                    window.requestAnimationFrame(() => document.getElementById("item-expires")?.focus());
                    return;
                  }
                  setDateOpen(false);
                  update({ expiresOn: useByFor(c.id, form) });
                }}
              >
                {c.label}
              </Chip>
            );
          })}
        </div>
        {useBy === "date" || dateOpen ? (
          <Input
            id="item-expires"
            type="date"
            aria-label="Use by"
            value={form.expiresOn}
            min={form.boughtOn || undefined}
            onChange={(e) => update({ expiresOn: e.target.value })}
            aria-invalid={!!err("expiresOn")}
            aria-describedby={err("expiresOn") ? "item-expires-error" : undefined}
            className={cn(K_INPUT, "h-12 w-full max-w-60 pr-3 sm:h-12")}
          />
        ) : null}
        <FieldError id="item-expires-error" message={err("expiresOn")} />
        <div data-field="boughtOn" className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {boughtOpen ? (
            <Input
              id="item-bought"
              type="date"
              aria-label="Bought on"
              value={form.boughtOn}
              max={today}
              onChange={(e) => update({ boughtOn: e.target.value })}
              aria-invalid={!!err("boughtOn")}
              aria-describedby={err("boughtOn") ? "item-bought-error" : undefined}
              className={cn(K_INPUT, "h-12 w-full max-w-60 pr-3 sm:h-12")}
            />
          ) : (
            <>
              <span>Bought {form.boughtOn === today ? "today" : dayMonth(form.boughtOn)}</span>
              <button
                type="button"
                onClick={() => {
                  setBoughtOpen(true);
                  window.requestAnimationFrame(() => document.getElementById("item-bought")?.focus());
                }}
                className="min-h-11 rounded-lg px-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Change
              </button>
            </>
          )}
        </div>
        <FieldError id="item-bought-error" message={err("boughtOn")} />
      </fieldset>
    ),
    note: notes ? (
      <NoteField
        key="note"
        id="item-note"
        value={form.note}
        onChange={(note) => update({ note })}
        pantry={group ? { kind: "group", name: group.name } : { kind: "personal" }}
        error={err("note")}
      />
    ) : null,
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-1">
        <BackButton />
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Bought</h1>
      </header>

      <form onSubmit={submit} noValidate className="max-w-xl space-y-6">
        {boughtSections(group !== null, notes).map((id) =>
          id === "waste" && showAsk && group ? (
            <React.Fragment key="waste">
              {sections[id]}
              <AskSettingFields
                idPrefix="add-item-ask"
                groupName={group.name}
                draft={askDraft}
                onChange={setAskDraft}
                roster={members.data ? members.data.filter((m) => m.role !== "viewer").map((m) => m.subjectId) : null}
                answerer={meId}
                meId={meId}
                names={names}
              />
            </React.Fragment>
          ) : (
            sections[id]
          ),
        )}

        {serverError ? (
          <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
            {serverError}
          </p>
        ) : null}
        {showErrors && !preview.request && !serverError ? (
          <p role="alert" className="sr-only">
            {Object.values(preview.errors).join(". ")}
          </p>
        ) : null}

        {/* The one main button, named, in thumb reach (SM-15): "Add Milk · ₹68.00 / to Flat 4B". */}
        <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:static min-[900px]:max-w-sm">
          <Button ref={addRef} type="submit" className={cn(MAIN_BUTTON, "shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none")} loading={busy}>
            <MainButtonLabel title={main.title} who={main.who} />
          </Button>
        </div>
      </form>
    </div>
  );
}

const LEGEND = "mb-2 block text-sm font-extrabold";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-medium text-destructive">
      {message}
    </p>
  );
}

function AddItemSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Skeleton className="h-[480px] w-full rounded-[20px]" />
        <Skeleton className="h-48 w-full rounded-[20px]" />
      </div>
    </div>
  );
}

