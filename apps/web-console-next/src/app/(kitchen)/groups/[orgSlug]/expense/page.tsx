"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CheckCircle2, CookingPot, Minus, Plus } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { recordRecentGroup } from "@/lib/recent-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_INPUT, PageHeader } from "@/components/kitchen/kit";
import { refreshLedger, useBalances, useGroupRole, useOfferUndo } from "@/components/kitchen/ledger-data";
import { Chip, Money, PersonAvatar, Segmented } from "@/components/kitchen/ledger-ui";
import { memberLabel, memberLabelInline, sortMembers, type MemberNames } from "@/components/kitchen/members";
import { useMemberNames } from "@/components/kitchen/people-data";
import { currencyPrefix, formatMinor } from "@/components/kitchen/money";
import {
  EXPENSE_TITLE_MAX,
  MAX_SHARES,
  SPLIT_MODE_OPTIONS,
  firstExpenseError,
  initialExpenseForm,
  previewExpense,
  stepShares,
  toggleEveryone,
  type ExpenseCheck,
  type ExpenseForm,
} from "@/components/kitchen/expense-form";

/**
 * Add expense (CP-8): what for, how much, who paid (one person, or several
 * with amounts that must add up), and how it is split — Equally, Exact, % or
 * Shares — with every person's share previewed live by `@saas/kitchen-engine`,
 * the same maths the server splits it with. Saving posts the expense and goes
 * back to the group's Activity, with a toast that can undo it.
 */
export default function AddExpensePage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  const groups = useGroups();
  const group = groups.data?.find((g) => g.slug === slug) ?? null;
  const foundSlug = group?.slug ?? null;

  React.useEffect(() => {
    if (foundSlug) recordRecentGroup(foundSlug);
  }, [foundSlug]);

  if (groups.loading || (!group && groups.fetching)) return <ExpenseSkeleton />;
  if (groups.error) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups. {groups.error.message}</p>
        <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (!group) {
    return (
      <KCard className="flex flex-col items-center px-6 py-12 text-center">
        <h1 className="text-lg font-bold tracking-tight">You&apos;re not in this group</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Add the expense in one of your groups instead.
        </p>
        <Button asChild className={cn(K_BUTTON, "mt-5")}>
          <Link href="/groups">Your groups</Link>
        </Button>
      </KCard>
    );
  }
  return <ExpenseLoader group={group} />;
}

/**
 * Who can be on the expense: the group's balances list every member (and
 * anyone who left still owing or owed); the member list (every member may
 * read it since CP-9) narrows that to the people still in the group. A viewer
 * adds nothing.
 */
function ExpenseLoader({ group }: { group: PublicOrganization }) {
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const balances = useBalances(group.id);
  const { members, roleKnown, canWrite } = useGroupRole(group.id, myId);
  const names = useMemberNames(members.data);

  const roster = React.useMemo(() => {
    if (!balances.data) return null;
    let ids = balances.data.balances.map((b) => b.subjectId);
    if (members.data) {
      const active = new Set(members.data.map((m) => m.subjectId));
      ids = [...ids.filter((id) => active.has(id)), ...[...active].filter((id) => !ids.includes(id))];
    }
    return sortMembers(ids, myId, names);
  }, [balances.data, members.data, myId, names]);

  if (profile.loading || balances.loading || !roleKnown) return <ExpenseSkeleton />;
  if (!canWrite) {
    return (
      <KCard className="flex flex-col items-center px-6 py-12 text-center">
        <h1 className="text-lg font-bold tracking-tight">You view {group.name}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Viewers see the group&apos;s money but don&apos;t add to it. Ask an owner to make you a member.
        </p>
        <Button asChild className={cn(K_BUTTON, "mt-5")}>
          <Link href={`/groups/${group.slug}`}>Back to {group.name}</Link>
        </Button>
      </KCard>
    );
  }
  if (balances.error || !roster || !balances.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load who&apos;s in {group.name}. {balances.error?.message ?? ""}
        </p>
        <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  return <ExpenseFormView group={group} roster={roster} myId={myId} currency={balances.data.currency} names={names} />;
}

const MODE_HINT: Record<ExpenseForm["mode"], string> = {
  equal: "Everyone ticked pays the same; any odd paisa goes to whoever's listed first.",
  exact: "Type what each person owes. They must add up to the total.",
  percent: "Give each person a percentage. They must add up to 100%.",
  shares: "Two shares pays twice as much as one.",
};

function ExpenseFormView({
  group,
  roster,
  myId,
  currency,
  names,
}: {
  group: PublicOrganization;
  roster: string[];
  myId: string | null;
  currency: string;
  names: MemberNames;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const offerUndo = useOfferUndo();
  const [form, setForm] = React.useState<ExpenseForm>(() => initialExpenseForm(roster, myId));
  const [showErrors, setShowErrors] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  /** People the server says are no longer in the group. */
  const [gone, setGone] = React.useState<readonly string[]>([]);
  const people = React.useMemo(() => roster.filter((id) => !gone.includes(id)), [roster, gone]);
  const preview = React.useMemo(() => previewExpense(form, people, currency), [form, people, currency]);
  const prefix = currencyPrefix(currency);
  const update = (patch: Partial<ExpenseForm>) => setForm((f) => ({ ...f, ...patch }));
  /** Set one person's entry in one of the per-person maps, from the latest state. */
  const updatePerson = (key: "payerAmounts" | "exact" | "percent", id: string, value: string) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [id]: value } }));
  const err = (field: keyof typeof preview.errors) => (showErrors ? preview.errors[field] : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    setServerError(null);
    const request = preview.request;
    if (!request) {
      const first = firstExpenseError(preview.errors);
      if (first) document.querySelector<HTMLElement>(`[data-field="${first}"] :is(input, button)`)?.focus();
      return;
    }
    setBusy(true);
    const r = await wrap(() => client.kitchen.createExpense(group.id, request, { idempotencyKey: crypto.randomUUID() }));
    if (!r.ok) {
      setBusy(false);
      const details = r.error.details ?? {};
      if (r.error.reason === "not_in_group") {
        const ids = Array.isArray(details["subjectIds"])
          ? (details["subjectIds"] as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        setGone((g) => [...new Set([...g, ...ids])]);
        setServerError(
          ids.length > 0
            ? `${ids.map((id) => memberLabel(id, myId, names)).join(", ")} ${ids.length === 1 ? "has" : "have"} left ${group.name}, so ${ids.length === 1 ? "they're" : "they're all"} off this expense now. Check the split and save again.`
            : "Someone on this expense has left the group. Check the split and save again.",
        );
        return;
      }
      if (r.error.reason === "currency_mismatch") {
        refreshLedger(qc, group.id);
        setServerError(`${group.name} counts in ${String(details["currency"] ?? "another currency")}. Reload and try again.`);
        return;
      }
      setServerError(r.error.message);
      return;
    }
    refreshLedger(qc, group.id);
    offerUndo(
      group.id,
      r.data.txn,
      `Added: ${request.title}`,
      `${formatMinor(request.totalMinor, currency)}, split ${SPLIT_MODE_OPTIONS.find((m) => m.id === request.mode)?.name.toLowerCase() ?? request.mode}.`,
    );
    router.push(`/groups/${group.slug}`);
  };

  const allIn = people.every((id) => form.included[id]);

  return (
    <div className="space-y-6">
      <Link
        href={`/groups/${group.slug}`}
        className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{group.name}</span>
      </Link>
      <PageHeader title="Add expense" subtitle={`A bill in ${group.name}, in ${currency}.`} />

      <form
        onSubmit={submit}
        noValidate
        className="grid gap-5 min-[900px]:grid-cols-2 min-[900px]:items-start"
      >
        {/* What and how much */}
        <KCard className="space-y-5 p-5 min-[900px]:col-start-1">
          <div className="space-y-2" data-field="title">
            <Label htmlFor="expense-title">What for</Label>
            <Input
              id="expense-title"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. Vegetables from the market"
              maxLength={EXPENSE_TITLE_MAX}
              autoComplete="off"
              aria-invalid={!!err("title")}
              aria-describedby={err("title") ? "expense-title-error" : undefined}
              className={K_INPUT}
            />
            {err("title") ? (
              <p id="expense-title-error" className="text-sm font-medium text-destructive">
                {err("title")}
              </p>
            ) : null}
          </div>
          <div className="space-y-2" data-field="amount">
            <Label htmlFor="expense-amount">Amount</Label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                {prefix}
              </span>
              <Input
                id="expense-amount"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => update({ amount: e.target.value })}
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={!!err("amount")}
                aria-describedby={err("amount") ? "expense-amount-error" : undefined}
                className={cn(K_INPUT, "h-14 text-xl font-bold tabular-nums sm:h-14 sm:text-xl", prefix.length > 1 ? "pl-14" : "pl-9")}
              />
            </div>
            {err("amount") ? (
              <p id="expense-amount-error" className="text-sm font-medium text-destructive">
                {err("amount")}
              </p>
            ) : null}
          </div>
        </KCard>

        {/* Who paid */}
        <KCard className="p-5 min-[900px]:col-start-1" data-field="payers">
          <fieldset>
            <legend className="text-base font-bold tracking-tight">Paid by</legend>
            {!form.severalPayers ? (
              <div role="group" aria-label="Who paid" className="mt-3 flex flex-wrap gap-2">
                {people.map((id) => (
                  <Chip
                    key={id}
                    aria-pressed={form.payerId === id}
                    selected={form.payerId === id}
                    onClick={() => update({ payerId: id })}
                  >
                    {memberLabel(id, myId, names)}
                  </Chip>
                ))}
              </div>
            ) : (
              <ul className="mt-2 divide-y">
                {people.map((id) => (
                  <li key={id} className="py-2">
                    <div className="flex items-center gap-3">
                      <PersonAvatar subjectId={id} meId={myId} names={names} />
                      <label htmlFor={`payer-${id}`} className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                        {memberLabel(id, myId, names)}
                      </label>
                      <MoneyInput
                        id={`payer-${id}`}
                        prefix={prefix}
                        value={form.payerAmounts[id] ?? ""}
                        invalid={!!preview.payerErrors[id]}
                        describedBy={preview.payerErrors[id] ? `payer-${id}-error` : undefined}
                        onChange={(v) => updatePerson("payerAmounts", id, v)}
                        label={`What ${memberLabelInline(id, myId, names)} paid`}
                      />
                    </div>
                    {preview.payerErrors[id] ? (
                      <p id={`payer-${id}-error`} className="mt-1 text-right text-sm font-medium text-destructive">
                        {preview.payerErrors[id]}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="several-payers" className="flex min-h-11 flex-1 cursor-pointer items-center text-[15px] font-medium">
                Several people paid
              </Label>
              <Switch
                id="several-payers"
                checked={form.severalPayers}
                onCheckedChange={(on) => update({ severalPayers: on })}
              />
            </div>
            {form.severalPayers && preview.paid ? <CheckLine check={preview.paid} /> : null}
            {err("payers") ? <p className="mt-2 text-sm font-medium text-destructive">{err("payers")}</p> : null}
          </fieldset>
        </KCard>

        {/* How it's split, and Save */}
        <div className="space-y-4 min-[900px]:sticky min-[900px]:top-6 min-[900px]:col-start-2 min-[900px]:row-span-3 min-[900px]:row-start-1">
          <KCard className="p-5" data-field="split">
            <h2 id="split-heading" className="text-base font-bold tracking-tight">
              Split
            </h2>
            <Segmented
              label="How to split it"
              value={form.mode}
              options={SPLIT_MODE_OPTIONS}
              onChange={(mode) => update({ mode })}
              className="mt-3"
            />
            <p className="mt-2 text-sm text-muted-foreground">{MODE_HINT[form.mode]}</p>

            {form.mode === "equal" ? (
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 rounded-xl px-3 text-sm font-semibold text-primary"
                  onClick={() => setForm((f) => toggleEveryone(f, people))}
                >
                  {allIn ? "No one" : "Everyone"}
                </Button>
              </div>
            ) : null}

            <ul aria-labelledby="split-heading" className={cn("divide-y", form.mode === "equal" ? "mt-0" : "mt-2")}>
              {preview.people.map((p) => {
                const name = memberLabel(p.subjectId, myId, names);
                const owed =
                  p.owedMinor === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Money minor={p.owedMinor} currency={currency} className={cn(!p.inSplit && "text-muted-foreground")} />
                  );
                return (
                  <li key={p.subjectId} className="py-2">
                    <div className="flex min-h-11 items-center gap-3">
                      {form.mode === "equal" ? (
                        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked={!!form.included[p.subjectId]}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setForm((f) => ({ ...f, included: { ...f.included, [p.subjectId]: checked } }));
                            }}
                            className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                          />
                          <PersonAvatar subjectId={p.subjectId} meId={myId} names={names} />
                          <span className="truncate text-[15px] font-semibold">{name}</span>
                        </label>
                      ) : (
                        <>
                          <PersonAvatar subjectId={p.subjectId} meId={myId} names={names} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{name}</span>
                            {form.mode === "percent" || form.mode === "shares" ? (
                              <span className="block text-sm tabular-nums text-muted-foreground">
                                <span className="sr-only">Owes </span>
                                {owed}
                              </span>
                            ) : null}
                          </span>
                        </>
                      )}

                      {form.mode === "exact" ? (
                        <MoneyInput
                          id={`split-${p.subjectId}`}
                          prefix={prefix}
                          value={form.exact[p.subjectId] ?? ""}
                          invalid={!!p.error}
                          describedBy={p.error ? `split-${p.subjectId}-error` : undefined}
                          onChange={(v) => updatePerson("exact", p.subjectId, v)}
                          label={`What ${memberLabelInline(p.subjectId, myId, names)} ${p.subjectId === myId ? "owe" : "owes"}`}
                        />
                      ) : form.mode === "percent" ? (
                        <div className="relative w-24 shrink-0">
                          <Input
                            id={`split-${p.subjectId}`}
                            inputMode="decimal"
                            value={form.percent[p.subjectId] ?? ""}
                            onChange={(e) => updatePerson("percent", p.subjectId, e.target.value)}
                            placeholder="0"
                            autoComplete="off"
                            aria-label={`Percentage for ${name}`}
                            aria-invalid={!!p.error}
                            aria-describedby={p.error ? `split-${p.subjectId}-error` : undefined}
                            className={cn(K_INPUT, "pr-8 text-right tabular-nums")}
                          />
                          <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            %
                          </span>
                        </div>
                      ) : form.mode === "shares" ? (
                        <SharesStepper
                          value={form.shares[p.subjectId] ?? 0}
                          name={name}
                          onStep={(d) => setForm((f) => stepShares(f, p.subjectId, d))}
                        />
                      ) : (
                        <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums">{owed}</span>
                      )}
                    </div>
                    {p.error ? (
                      <p id={`split-${p.subjectId}-error`} className="mt-1 text-right text-sm font-medium text-destructive">
                        {p.error}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {preview.split ? (
              <CheckLine check={preview.split} extra={form.mode === "percent" ? preview.percentText : null} />
            ) : (
              <p className="mt-3 rounded-xl bg-background px-3 py-2.5 text-sm text-muted-foreground">
                Enter the amount to see everyone&apos;s share.
              </p>
            )}
            {err("split") ? <p className="mt-2 text-sm font-medium text-destructive">{err("split")}</p> : null}
          </KCard>

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
              <Link href={`/groups/${group.slug}`}>Cancel</Link>
            </Button>
            <Button type="submit" className={cn(K_BUTTON, "h-12 min-[560px]:min-w-48")} loading={busy}>
              Save expense
            </Button>
          </div>
        </div>

        {/* The dish maker does this by portions (CP-15). */}
        <KCard className="flex gap-4 bg-cp-tomato-tint/40 p-5 min-[900px]:col-start-1">
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cp-tomato-tint text-cp-tomato">
            <CookingPot className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">Cooked something?</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cook a dish takes the ingredients from your pantries and splits it by portions.
            </p>
            <Button asChild variant="outline" className={cn(K_BUTTON, "mt-3 bg-card px-4")}>
              <Link href="/cook">Cook a dish</Link>
            </Button>
          </div>
        </KCard>
      </form>
    </div>
  );
}

/** "₹1,150.00 of ₹1,200.00 assigned", green when it adds up, red when it doesn't. */
function CheckLine({ check, extra }: { check: ExpenseCheck; extra?: string | null }) {
  const Icon = check.ok ? CheckCircle2 : AlertCircle;
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold tabular-nums",
        check.ok ? "bg-cp-herb-tint text-primary" : "bg-cp-expired-tint text-destructive",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {check.text}
        {extra ? ` · ${extra}` : ""}
      </span>
    </p>
  );
}

function MoneyInput({
  id,
  prefix,
  value,
  onChange,
  invalid,
  describedBy,
  label,
}: {
  id: string;
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy: string | undefined;
  label: string;
}) {
  return (
    <div className="relative w-32 shrink-0">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {prefix}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn(K_INPUT, "text-right tabular-nums", prefix.length > 1 ? "pl-12" : "pl-7")}
      />
    </div>
  );
}

function SharesStepper({ value, name, onStep }: { value: number; name: string; onStep: (delta: number) => void }) {
  const btn =
    "grid h-11 w-11 place-items-center rounded-full border border-input bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Shares for ${name}`}>
      <button type="button" className={btn} aria-label={`One share fewer for ${name}`} disabled={value <= 0} onClick={() => onStep(-1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <span aria-live="polite" className="w-8 text-center text-[15px] font-bold tabular-nums">
        {value}
        <span className="sr-only"> {value === 1 ? "share" : "shares"}</span>
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`One share more for ${name}`}
        disabled={value >= MAX_SHARES}
        onClick={() => onStep(1)}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function ExpenseSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-5 min-[900px]:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-[20px]" />
        <Skeleton className="h-72 w-full rounded-[20px]" />
      </div>
    </div>
  );
}
