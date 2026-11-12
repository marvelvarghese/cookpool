"use client";

import * as React from "react";
import Link from "./link";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { SettlementMethod, SettlePayment } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { K_BUTTON } from "./kit";
import { Face } from "./faces-ui";
import { Chip, Money } from "./ledger-ui";
import { formatMinor } from "./money";
import { SETTLE_METHODS, paymentAction, paymentSentence, paymentToast, settlementRequest } from "./settle";
import { refreshLedger } from "./ledger-data";
import { useMemberNames } from "./people-data";
import { useProfile } from "./data";
import { refusedToast, undoFailed, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { paymentPatches, paymentTxn, txnReversedPatches } from "./cache-patches";
import { beginWrite } from "./optimistic-data";

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
              className="block truncate rounded text-[15px] font-medium leading-snug underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sentence}
            </Link>
          ) : (
            <p className="truncate text-[15px] font-medium leading-snug">{sentence}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">
            <Money
              minor={payment.amountMinor}
              currency={currency}
              className={cn(
                "font-medium",
                payment.fromSubjectId === meId ? "text-cp-owe" : payment.toSubjectId === meId ? "text-cp-owed" : "text-foreground",
              )}
            />
            {groupName ? ` · ${groupName}` : null}
          </p>
        </div>
        {recorded ? (
          <span role="status" className="shrink-0 px-2 text-sm font-medium text-muted-foreground">
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
          <span className="shrink-0 text-right text-[13px] font-medium text-muted-foreground">{why}</span>
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
