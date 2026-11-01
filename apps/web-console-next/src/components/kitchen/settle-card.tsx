"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Route, X } from "lucide-react";
import type { SettlementMethod, SettlePayment, SettlePlan } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON, GroupAvatar } from "./kit";
import { Chip, Money, PersonAvatar } from "./ledger-ui";
import { memberLabel, memberLabelInline } from "./members";
import { formatMinor } from "./money";
import { debtsBehind } from "./debts";
import { TXN_KIND_META } from "./activity";
import { SETTLE_METHODS, paymentSentence, settlementRequest, workingLine, type GroupRef } from "./settle";
import { refreshLedger, useAllActivity, useOfferUndo } from "./ledger-data";
import { useMemberNames } from "./people-data";

/**
 * "Fewest payments" for one group (CP-8): the working (debts → pairs →
 * payments), a disclosure with the pairwise debts behind it (computed here
 * from the whole feed with the engine's `pairLines`), and each payment of the
 * plan with Record (UPI · Cash · Bank). Used on the group's Balances tab and
 * on Settle up.
 */
export function SettleCard({
  group,
  plan,
  loading,
  error,
  reload,
  meId,
  canRecordAny,
  canWrite = true,
  showGroup = false,
  className,
}: {
  group: GroupRef;
  plan: SettlePlan | null;
  loading: boolean;
  error: { message: string } | null;
  reload: () => void;
  meId: string | null;
  /** Owners and admins may record anyone's payment. */
  canRecordAny: boolean;
  /** False for a viewer (CP-9): they record nothing, not even their own payments. */
  canWrite?: boolean;
  /** Name the group in the card's heading (Settle up). */
  showGroup?: boolean;
  className?: string;
}) {
  return (
    <KCard className={cn("p-5", className)}>
      <div className="flex items-center gap-3">
        {showGroup ? <GroupAvatar name={group.name} size="sm" /> : null}
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold tracking-tight">
            {showGroup ? group.name : "Fewest payments"}
          </h3>
          {showGroup ? <p className="text-xs text-muted-foreground">Fewest payments</p> : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : error || !plan ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the plan. {error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-3 rounded-xl bg-background px-3 py-2.5 text-sm font-semibold tabular-nums">
            <span className="sr-only">The working: </span>
            {workingLine(plan.working)}
          </p>
          {plan.working.debts > 0 ? <DebtsBehind orgId={group.id} meId={meId} currency={plan.currency} /> : null}

          {plan.payments.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {plan.working.debts === 0 ? "Nothing to settle yet." : "Everyone is settled up."}
            </p>
          ) : (
            <>
              <ul className="mt-3 divide-y">
                {plan.payments.map((p) => (
                  <PaymentRow
                    key={`${p.fromSubjectId}>${p.toSubjectId}`}
                    orgId={group.id}
                    payment={p}
                    currency={plan.currency}
                    meId={meId}
                    canRecord={canWrite && (canRecordAny || p.fromSubjectId === meId || p.toSubjectId === meId)}
                  />
                ))}
              </ul>
              {!canWrite ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  You view this group: the people in a payment, or an owner or admin, record it.
                </p>
              ) : !canRecordAny && plan.payments.some((p) => p.fromSubjectId !== meId && p.toSubjectId !== meId) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  The two people in a payment, or an owner or admin, can record it.
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </KCard>
  );
}

// ── The debts behind the plan ─────────────────────────────────────

function DebtsBehind({ orgId, meId, currency }: { orgId: string; meId: string | null; currency: string }) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const all = useAllActivity(orgId, open);
  const names = useMemberNames();
  const debts = React.useMemo(() => (all.data ? debtsBehind(all.data.txns) : null), [all.data]);

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="-mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
        {open ? "Hide the debts behind this" : "Show the debts behind this"}
      </button>
      <div id={panelId} hidden={!open}>
        {!open ? null : all.loading ? (
          <div className="space-y-2 py-2" aria-hidden>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : all.error || !debts ? (
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the debts. {all.error?.message ?? ""}</p>
            <Button variant="outline" className={K_BUTTON} onClick={all.reload}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            <p className="text-xs text-muted-foreground">
              Each entry makes the people in it owe whoever paid. Where two people owe each other, the
              debts cancel; the plan then routes what&apos;s left through as few payments as it can.
              {all.data?.truncated ? " Only the newest 5,000 entries are shown." : ""}
            </p>
            <ul className="space-y-3">
              {debts.pairs.map((pair) => (
                <li key={`${pair.a}|${pair.b}`} className="rounded-xl border bg-background p-3">
                  <p className="text-sm font-semibold">
                    {pair.debtorId && pair.creditorId ? (
                      <>
                        {memberLabel(pair.debtorId, meId, names)} {pair.debtorId === meId ? "owe" : "owes"}{" "}
                        {memberLabelInline(pair.creditorId, meId, names)}{" "}
                        <Money minor={pair.netMinor} currency={currency} className="font-bold" />
                      </>
                    ) : (
                      <>
                        {memberLabel(pair.a, meId, names)} and {memberLabelInline(pair.b, meId, names)}:{" "}
                        <span className="font-normal text-muted-foreground">cancels out</span>
                      </>
                    )}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {pair.lines.map((line, i) => (
                      <li key={`${line.txnId}-${i}`} className="flex items-start justify-between gap-3 text-xs">
                        <span className="min-w-0">
                          <span className={cn("block truncate font-medium", line.reversed && "line-through text-muted-foreground")}>
                            {line.title}
                          </span>
                          <span className="block text-muted-foreground">
                            {TXN_KIND_META[line.kind].label} · {memberLabel(line.debtorId, meId, names)}{" "}
                            {line.debtorId === meId ? "owe" : "owes"} {memberLabelInline(line.creditorId, meId, names)}
                          </span>
                        </span>
                        <Money minor={line.amountMinor} currency={currency} className="shrink-0 font-semibold" />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── One payment, and recording it ─────────────────────────────────

const METHOD_LABEL: Record<SettlementMethod, string> = { upi: "UPI", cash: "cash", bank: "bank transfer", other: "other" };

export function PaymentRow({
  orgId,
  payment,
  currency,
  meId,
  canRecord,
  groupName,
  groupHref,
}: {
  orgId: string;
  payment: SettlePayment;
  currency: string;
  meId: string | null;
  canRecord: boolean;
  /** On "All groups": the group the payment is in. */
  groupName?: string;
  groupHref?: string;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const offerUndo = useOfferUndo();
  const [choosing, setChoosing] = React.useState(false);
  const [busy, setBusy] = React.useState<SettlementMethod | null>(null);
  const chipsId = React.useId();
  const names = useMemberNames();
  const sentence = paymentSentence(payment, meId, names);
  const counterpart = payment.fromSubjectId === meId ? payment.toSubjectId : payment.fromSubjectId;
  // Your own payments open the person: everything between you two, across groups.
  const involvesMe = !!meId && (payment.fromSubjectId === meId || payment.toSubjectId === meId);

  const record = async (method: SettlementMethod) => {
    if (busy) return;
    setBusy(method);
    const r = await wrap(() =>
      client.kitchen.createSettlement(orgId, settlementRequest(payment, method), {
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    setBusy(null);
    if (!r.ok) {
      const description =
        r.error.reason === "not_a_party"
          ? "Only the two people in a payment, or an owner or admin, can record it."
          : r.error.reason === "not_in_group"
            ? "One of them has left the group. An owner or admin can undo their entries instead."
            : r.error.message;
      toast({ kind: "error", title: "Couldn't record the payment", description });
      refreshLedger(qc, orgId);
      return;
    }
    setChoosing(false);
    refreshLedger(qc, orgId);
    offerUndo(
      orgId,
      r.data.txn,
      "Payment recorded",
      `${sentence} ${formatMinor(payment.amountMinor, currency)} by ${METHOD_LABEL[method]}.`,
    );
  };

  return (
    <li className="py-3">
      {/* One line from 560px; on a phone, Record wraps under the amount. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PersonAvatar subjectId={counterpart} meId={meId} names={names} />
        <div className="min-w-[10rem] flex-1">
          {involvesMe ? (
            <Link
              href={`/people/${encodeURIComponent(counterpart)}`}
              className="block rounded text-[15px] font-semibold leading-snug underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sentence}
            </Link>
          ) : (
            <p className="text-[15px] font-semibold leading-snug">{sentence}</p>
          )}
          {groupName ? (
            groupHref ? (
              <Link href={groupHref} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                {groupName}
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">{groupName}</p>
            )
          ) : null}
        </div>
        <Money
          minor={payment.amountMinor}
          currency={currency}
          className={cn(
            "shrink-0 text-[15px] font-bold",
            payment.fromSubjectId === meId ? "text-cp-owe" : payment.toSubjectId === meId ? "text-cp-owed" : "",
          )}
        />
        {canRecord && !choosing ? (
          <Button
            variant="outline"
            className={cn(K_BUTTON, "ml-auto shrink-0 px-4")}
            aria-expanded={false}
            aria-controls={chipsId}
            onClick={() => setChoosing(true)}
          >
            Record
            <span className="sr-only">
              : {sentence} {formatMinor(payment.amountMinor, currency)}
            </span>
          </Button>
        ) : null}
      </div>
      {choosing ? (
        <div id={chipsId} className="mt-3 flex flex-wrap items-center gap-2 pl-12">
          <span className="w-full text-xs font-medium text-muted-foreground" id={`${chipsId}-label`}>
            How was it paid? Cookpool records it; the money moves in your UPI, bank or cash.
          </span>
          <div role="group" aria-labelledby={`${chipsId}-label`} className="flex flex-wrap gap-2">
            {SETTLE_METHODS.map((m) => (
              <Chip
                key={m.id}
                disabled={busy !== null}
                selected={busy === m.id}
                aria-busy={busy === m.id || undefined}
                className={cn(busy === m.id && "animate-pulse disabled:opacity-100")}
                onClick={() => void record(m.id)}
              >
                {m.label}
              </Chip>
            ))}
          </div>
          <button
            type="button"
            aria-label="Cancel recording"
            disabled={busy !== null}
            onClick={() => setChoosing(false)}
            className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** A small "how settling works" note, shared by the Balances tab and Settle up. */
export function SettleNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-muted-foreground", className)}>
      <Route className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      Cookpool records payments; the money moves in your UPI, bank or cash.
    </p>
  );
}
