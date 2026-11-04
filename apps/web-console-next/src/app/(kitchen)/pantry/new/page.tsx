"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Pantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_INPUT } from "@/components/kitchen/kit";
import { Chip } from "@/components/kitchen/ledger-ui";
import { memberLabel } from "@/components/kitchen/members";
import { currencyPrefix } from "@/components/kitchen/money";
import { canManageGroup, roleFromKitchen } from "@/components/kitchen/groups";
import { useMemberNames, useMyBalances, useMyRoles } from "@/components/kitchen/people-data";
import { useAddItem, useMembersOf, usePantries } from "@/components/kitchen/pantry-data";
import { PantryPicker } from "@/components/kitchen/pantry-ui";
import { ALL_PANTRIES, PERSONAL_PANTRY, pantryKey, parsePantryParam } from "@/components/kitchen/pantry";
import {
  ITEM_CATEGORIES,
  ITEM_NAME_MAX,
  MAIN_UNITS,
  MORE_UNITS,
  addButtonLabel,
  chipWindow,
  firstItemError,
  initialItemForm,
  localIsoDay,
  payerHelp,
  previewItemForm,
  wasteOptions,
  type ItemField,
  type ItemForm,
} from "@/components/kitchen/item-form";

/**
 * Add an item (CP-12): what it is, its category, how much (in units the
 * engine knows) and what was paid — with the price per kg and per 100 g
 * worked out live — when it was bought and when to use it by, and the pantry
 * it goes in: your own, or a group you add to (a searchable picker, recent
 * first). For a group: who paid, and who pays if some of it goes to waste.
 * Adding charges nobody; the toast can undo it for ten seconds.
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

  if (pantries.loading || profile.loading || rolesLoading) return <AddItemSkeleton />;
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
  return <AddItemForm pantries={writable} start={start} meId={meId} viewerOf={viewerOnly} />;
}

function AddItemForm({
  pantries,
  start,
  meId,
  viewerOf,
}: {
  pantries: readonly Pantry[];
  start: string;
  meId: string | null;
  /** The group the link asked for, when you only view it (the item goes to your own pantry instead). */
  viewerOf: Pantry | null;
}) {
  const router = useRouter();
  const balances = useMyBalances();
  const today = React.useMemo(() => localIsoDay(new Date()), []);
  const [form, setForm] = React.useState<ItemForm>(() => initialItemForm({ today, pantry: start, meId }));
  const [moreUnits, setMoreUnits] = React.useState(() => MORE_UNITS.includes(form.unit));
  const [morePayers, setMorePayers] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [serverFields, setServerFields] = React.useState<Partial<Record<ItemField, string>>>({});
  // One key per item being added: a retry after a lost answer adds it once.
  const idemKey = React.useRef(crypto.randomUUID());

  const chosen = pantries.find((p) => pantryKey(p) === form.pantry) ?? pantries.find((p) => p.kind === "personal") ?? null;
  const group = chosen?.kind === "group" ? chosen : null;
  // Reads the chosen pantry's list ahead, so the item is listed there the moment it is added.
  const addItem = useAddItem(chosen ? pantryKey(chosen) : null);
  const members = useMembersOf(group?.orgId ?? null);
  const names = useMemberNames(members.data);
  const memberCounts = React.useMemo(
    () => new Map((balances.data?.groups ?? []).map((g) => [g.orgId, g.memberCount] as const)),
    [balances.data],
  );
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
      if (first) document.querySelector<HTMLElement>(`[data-field="${first}"] :is(input, button)`)?.focus();
      return;
    }
    setBusy(true);
    const paidBy = request.kind === "group" ? (request.body.paidBy ?? meId) : meId;
    void addItem({
      request,
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

  const wastes = group
    ? wasteOptions({ groupName: group.name, groupRule: group.wastePolicy, paidBy: form.paidBy, meId, names })
    : [];

  return (
    <div className="space-y-5">
      <Link
        href="/pantry"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Pantry
      </Link>
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Add to pantry</h1>
      {viewerOf && viewerOf.kind === "group" ? (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          You view {viewerOf.name}, so you can&apos;t add to its pantry. This goes to your own — or pick another group.
        </p>
      ) : null}

      <form onSubmit={submit} noValidate className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] min-[900px]:items-start">
        <KCard className="space-y-6 p-5">
          <div className="space-y-2" data-field="name">
            <Label htmlFor="item-name" className="text-sm font-bold">
              What did you buy?
            </Label>
            <Input
              id="item-name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Tomatoes"
              maxLength={ITEM_NAME_MAX}
              autoComplete="off"
              autoFocus
              aria-invalid={!!err("name")}
              aria-describedby={err("name") ? "item-name-error" : undefined}
              className={cn(K_INPUT, "h-12 sm:h-12")}
            />
            <FieldError id="item-name-error" message={err("name")} />
          </div>

          <fieldset data-field="category" aria-describedby={err("category") ? "item-category-error" : undefined}>
            <legend className="mb-2 text-sm font-bold">Category</legend>
            <div className="flex flex-wrap gap-2">
              {ITEM_CATEGORIES.map((c) => (
                <Chip key={c.id} aria-pressed={form.category === c.id} selected={form.category === c.id} onClick={() => update({ category: c.id })}>
                  {c.label}
                </Chip>
              ))}
            </div>
            <FieldError id="item-category-error" message={err("category")} />
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2" data-field="quantity">
              <Label htmlFor="item-qty" className="text-sm font-bold">
                Quantity
              </Label>
              <Input
                id="item-qty"
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => update({ quantity: e.target.value })}
                placeholder="1"
                autoComplete="off"
                aria-invalid={!!err("quantity")}
                aria-describedby={err("quantity") ? "item-qty-error" : "item-unit-line"}
                className={cn(K_INPUT, "h-12 tabular-nums sm:h-12")}
              />
            </div>
            <div className="space-y-2" data-field="price">
              <Label htmlFor="item-price" className="text-sm font-bold">
                Price paid
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
                  aria-describedby={err("price") ? "item-price-error" : "item-unit-line"}
                  className={cn(K_INPUT, "h-12 tabular-nums sm:h-12", prefix.length > 1 ? "pl-14" : "pl-8")}
                />
              </div>
            </div>
            <div className="col-span-2 -mt-1 space-y-1">
              <FieldError id="item-qty-error" message={err("quantity")} />
              <FieldError id="item-price-error" message={err("price")} />
            </div>
          </div>

          <fieldset className="-mt-2">
            <legend className="mb-2 text-sm font-bold">Unit</legend>
            <div className="flex flex-wrap gap-2">
              {[...MAIN_UNITS, ...(moreUnits ? MORE_UNITS : [])].map((u) => (
                <Chip key={u} aria-pressed={form.unit === u} selected={form.unit === u} onClick={() => update({ unit: u })} className="min-w-14 justify-center">
                  {u}
                </Chip>
              ))}
              {moreUnits ? null : (
                <Chip onClick={() => setMoreUnits(true)} className="text-muted-foreground">
                  more
                </Chip>
              )}
            </div>
            <p id="item-unit-line" role="status" aria-live="polite" className="mt-2 text-sm font-bold tabular-nums text-primary">
              {preview.perUnit ?? <span className="font-medium text-muted-foreground">Enter a quantity and price to see the price per unit.</span>}
            </p>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2" data-field="boughtOn">
              <Label htmlFor="item-bought" className="text-sm font-bold">
                Bought on
              </Label>
              <Input
                id="item-bought"
                type="date"
                value={form.boughtOn}
                max={today}
                onChange={(e) => update({ boughtOn: e.target.value })}
                aria-invalid={!!err("boughtOn")}
                aria-describedby={err("boughtOn") ? "item-bought-error" : undefined}
                className={cn(K_INPUT, "h-12 sm:h-12")}
              />
            </div>
            <div className="space-y-2" data-field="expiresOn">
              <Label htmlFor="item-expires" className="text-sm font-bold">
                Use by <span className="font-medium text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="item-expires"
                type="date"
                value={form.expiresOn}
                min={form.boughtOn || undefined}
                onChange={(e) => update({ expiresOn: e.target.value })}
                aria-invalid={!!err("expiresOn")}
                aria-describedby={err("expiresOn") ? "item-expires-error" : undefined}
                className={cn(K_INPUT, "h-12 sm:h-12")}
              />
            </div>
            <div className="col-span-2 -mt-1 space-y-1">
              <FieldError id="item-bought-error" message={err("boughtOn")} />
              <FieldError id="item-expires-error" message={err("expiresOn")} />
            </div>
          </div>
        </KCard>

        <div className="space-y-4 min-[900px]:sticky min-[900px]:top-6">
          <KCard className="space-y-2 p-5">
            <h2 className="text-sm font-bold">Put it in</h2>
            <PantryPicker
              pantries={pantries}
              value={chosen ? pantryKey(chosen) : PERSONAL_PANTRY}
              onChange={(key) => {
                setMorePayers(false);
                update({ pantry: key });
              }}
              label={group ? "Group pantry" : "Your own pantry"}
              idPrefix="add-item-pantry"
              meta="who"
              memberCounts={memberCounts}
            />
            <p className="text-[13px] text-muted-foreground">
              {group
                ? `Everyone in ${group.name} can see it and use it.`
                : "Only you can see it. You can still cook with it for any group."}
            </p>
          </KCard>

          {group ? (
            <KCard className="space-y-6 p-5">
              <fieldset data-field="paidBy">
                <legend className="mb-2 text-sm font-bold">Who paid?</legend>
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
                <p className="mt-2 text-[13px] text-muted-foreground">{payerHelp(form.paidBy, meId, names)}</p>
                <FieldError id="item-payer-error" message={err("paidBy")} />
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-bold">If some of it goes to waste</legend>
                <div className="space-y-2">
                  {wastes.map((w) => {
                    const on = form.waste === w.id;
                    return (
                      <label
                        key={w.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-2xl px-3.5 py-3 transition-colors",
                          on ? "border-2 border-primary bg-accent/60" : "border border-input bg-card hover:bg-accent/40",
                        )}
                      >
                        <input
                          type="radio"
                          name="item-waste"
                          checked={on}
                          onChange={() => update({ waste: w.id })}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[15px] font-bold">{w.label}</span>
                          <span className="block text-[13px] text-muted-foreground">{w.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </KCard>
          ) : null}

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

          <div className="flex flex-col-reverse gap-2 min-[560px]:flex-row min-[560px]:justify-end">
            <Button asChild variant="ghost" className={K_BUTTON}>
              <Link href="/pantry">Cancel</Link>
            </Button>
            <Button type="submit" className={cn(K_BUTTON, "h-12 min-[560px]:min-w-48")} loading={busy}>
              {addButtonLabel(group ? group.name : null)}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

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

