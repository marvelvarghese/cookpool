"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import type { SettlementMethod, SettlePayment, SettlePlan } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON, GroupAvatar } from "./kit";
import { Face } from "./faces-ui";
import { Chip, Money } from "./ledger-ui";
import { memberLabel, memberLabelInline } from "./members";
import { formatMinor } from "./money";
import { debtsBehind } from "./debts";
import { TXN_KIND_META } from "./activity";
import { SETTLE_METHODS, paymentAction, paymentSentence, paymentToast, settlementRequest, workingLine, type GroupRef } from "./settle";
import { refreshLedger, useAllActivity } from "./ledger-data";
import { useMemberNames } from "./people-data";
import { useProfile } from "./data";
import { refusedToast, undoFailed, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { paymentPatches, paymentTxn, txnReversedPatches } from "./cache-patches";
import { beginWrite } from "./optimistic-data";

/**
 * "Fewest payments" for one group (CP-8): the working (debts → pairs →
 * payments), a disclosure with the pairwise debts behind it (computed here
 * from the whole feed with the engine's `pairLines`), and each payment of the
 * plan with Record (UPI · Cash · Bank). The Groups page shows it beside the
 * list from 900px; on a phone, People lists a group's payments (SM-11).
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
                    {...recordable(p, { meId, canWrite, manager: canRecordAny })}
                  />
                ))}
              </ul>
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

/** Why a payment was refused, in one line (the messages Settle up and a person's page had, CP-8/CP-9). */
export function paymentRefusal(error: { reason?: string | undefined; message: string }, opts: { leftText?: string } = {}): string {
  if (error.reason === "not_a_party") return "Only the two people in a payment, or an owner or admin, can record it.";
  if (error.reason === "not_in_group") return opts.leftText ?? "One of them has left the group. An owner or admin can undo their entries instead.";
  return error.message;
}

/**
 * Record one payment of a group's plan (CP-8), shared by People's rows,
 * Home's "Paid" (CP-23) and a person's Record payment (CP-9). It shows at
 * once (Cookpool SM-5): the payment comes off the group's plan and off Home,
 * its row is at the top of the group's activity, and the one Undo toast is
 * up — before the server answers. Balances are the server's: they are read
 * again once it does. A refusal puts everything back exactly and the toast
 * says why in one line; Undo reverses it (at once on screen, on the server
 * once the payment has landed). Resolves true once recorded. The toast is
 * one line naming who paid whom (SM-11): "Paid Dev ₹25.00 · UPI".
 */
export function useRecordPayment() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  return React.useCallback(
    (input: {
      orgId: string;
      payment: SettlePayment;
      currency: string;
      method: SettlementMethod;
      /** Unused since SM-11 (the toast names who paid whom itself); kept for callers that pass it. */
      sentence?: string;
      /** What a refusal says when one of the two has left the group. */
      leftText?: string;
      /** Undo was pressed: the screen's own "recorded" marks go too. */
      onRestore?: () => void;
    }): Promise<boolean> => {
      const { orgId, payment, currency, method } = input;
      const change = { orgId, ...payment };
      const shown = paymentTxn(change, { currency, method, createdBy: meId ?? payment.fromSubjectId, at: new Date().toISOString() });
      const write = beginWrite(qc, paymentPatches(change, shown));
      const request = write.track(
        wrap(() =>
          client.kitchen.createSettlement(orgId, settlementRequest(payment, method), {
            idempotencyKey: crypto.randomUUID(),
          }),
        ),
      );
      let undone = false;
      let posted: string | null = null;
      const toast = offer({
        title: paymentToast(payment, { currency, method, meId, names }),
        undo: async (): Promise<UndoResult> => {
          const r = await request;
          if (!r.ok) return { ok: true, description: "Nothing was recorded." };
          const u = await write.track(wrap(() => client.kitchen.reverseTxn(orgId, r.data.txn.id, {}, { idempotencyKey: crypto.randomUUID() })));
          refreshLedger(qc, orgId);
          return u.ok ? { ok: true, description: "The payment is reversed." } : undoFailed(u.error);
        },
        restore: () => {
          undone = true;
          input.onRestore?.();
          // Before the answer the plan, Home and the activity are exactly as they were; after it, the row is struck through.
          write.restore(posted ? txnReversedPatches(orgId, posted) : []);
        },
      });
      return request.then((r) => {
        if (!r.ok) {
          write.rollback();
          refreshLedger(qc, orgId);
          toast.refuse(refusedToast("Couldn't record the payment", paymentRefusal(r.error, input.leftText ? { leftText: input.leftText } : {})));
          return false;
        }
        posted = r.data.txn.id;
        if (!undone) refreshLedger(qc, orgId);
        return true;
      });
    },
    [client, qc, offer, meId, names],
  );
}

/**
 * "How was it paid?" UPI · Cash · Bank, each recording the payment in one
 * tap, and × to close. The chip being recorded pulses; the rest wait.
 */
export function PaymentMethodChips({
  id,
  busy,
  onPick,
  onCancel,
  className,
}: {
  id: string;
  busy: SettlementMethod | null;
  onPick: (method: SettlementMethod) => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <div id={id} className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="sr-only" id={`${id}-label`}>
        How was it paid?
      </span>
      <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
        {SETTLE_METHODS.map((m) => (
          <Chip
            key={m.id}
            disabled={busy !== null}
            selected={busy === m.id}
            aria-busy={busy === m.id || undefined}
            className={cn(busy === m.id && "animate-pulse disabled:opacity-100")}
            onClick={() => onPick(m.id)}
          >
            {m.label}
          </Chip>
        ))}
      </div>
      <button
        type="button"
        aria-label="Cancel recording"
        disabled={busy !== null}
        onClick={onCancel}
        className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * One payment (SM-11): a face, who pays whom ("You pay Dev"), the amount —
 * blue when it comes to you, orange when you pay — with the group under it,
 * and its one action: Record → UPI · Cash · Bank. A payment you can't record
 * says why in two words ("View only", "Not involved").
 */
export function PaymentRow({
  orgId,
  payment,
  currency,
  meId,
  canRecord,
  why,
  groupName,
}: {
  orgId: string;
  payment: SettlePayment;
  currency: string;
  meId: string | null;
  canRecord: boolean;
  /** Why there is no Record, in two words. */
  why?: string;
  /** Across groups: the group the payment is in. */
  groupName?: string;
}) {
  const recordPayment = useRecordPayment();
  const [choosing, setChoosing] = React.useState(false);
  // Recorded, until the plan or the balances are read again without it (SM-5).
  const [recorded, setRecorded] = React.useState(false);
  const chipsId = React.useId();
  const names = useMemberNames();
  const sentence = paymentSentence(payment, meId, names);
  const counterpart = payment.fromSubjectId === meId ? payment.toSubjectId : payment.fromSubjectId;
  // Your own payments open the person: everything between you two, across groups.
  const involvesMe = !!meId && (payment.fromSubjectId === meId || payment.toSubjectId === meId);

  // Recorded at once (SM-5): the row leaves the plan (or, across groups, reads
  // "Recorded" until the balances are read again) with the Undo toast up.
  const record = (method: SettlementMethod) => {
    if (recorded) return;
    setChoosing(false);
    setRecorded(true);
    void recordPayment({ orgId, payment, currency, method, onRestore: () => setRecorded(false) }).then((ok) => {
      if (!ok) setRecorded(false);
    });
  };

  return (
    <li className="py-2.5">
      <div className="flex min-h-11 items-center gap-3">
        <Face subjectId={counterpart} meId={meId} names={names} />
        <div className="min-w-0 flex-1">
          {involvesMe ? (
            <Link
              href={`/people/${encodeURIComponent(counterpart)}`}
              className="block truncate rounded text-[15px] font-bold leading-snug underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sentence}
            </Link>
          ) : (
            <p className="truncate text-[15px] font-bold leading-snug">{sentence}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">
            <Money
              minor={payment.amountMinor}
              currency={currency}
              className={cn(
                "font-bold",
                payment.fromSubjectId === meId ? "text-cp-owe" : payment.toSubjectId === meId ? "text-cp-owed" : "text-foreground",
              )}
            />
            {groupName ? ` · ${groupName}` : null}
          </p>
        </div>
        {recorded ? (
          <span role="status" className="shrink-0 px-2 text-sm font-semibold text-muted-foreground">
            Recorded
          </span>
        ) : canRecord ? (
          choosing ? null : (
            <Button
              variant="outline"
              className={cn(K_BUTTON, "shrink-0 px-4")}
              aria-expanded={false}
              aria-controls={chipsId}
              onClick={() => setChoosing(true)}
            >
              Record
              <span className="sr-only">
                : {sentence} {formatMinor(payment.amountMinor, currency)}
              </span>
            </Button>
          )
        ) : why ? (
          <span className="shrink-0 text-right text-[13px] font-semibold text-muted-foreground">{why}</span>
        ) : null}
      </div>
      {choosing && !recorded ? (
        <PaymentMethodChips
          id={chipsId}
          busy={null}
          onPick={(m) => void record(m)}
          onCancel={() => setChoosing(false)}
          className="mt-2 pl-[52px]"
        />
      ) : null}
    </li>
  );
}

/** A row's Record, or why there is none (`paymentAction`), as PaymentRow's props. */
export function recordable(
  p: SettlePayment,
  ctx: { meId: string | null; canWrite: boolean; manager: boolean },
): { canRecord: boolean; why?: string } {
  const a = paymentAction(p, ctx);
  return a.record ? { canRecord: true } : { canRecord: false, why: a.why };
}
