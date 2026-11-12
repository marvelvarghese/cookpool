"use client";

/**
 * Cookpool's Money tab on spliteco-worker (cookpool-spliteco SE3): a kitchen
 * group read as Cookpool shows it (`?bucket=kitchen`: the Kitchen balance
 * only), a bill added and a payment made there with `bucket: "kitchen"`, and
 * the one-time handoff code for "More in Spliteco". The group read lives under
 * `qk.kitchenLedger(org)`, so `refreshLedger` refreshes it with the rest.
 */

import type { SplitecoExpenseRequest, SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { CookpoolError } from "@saas/sdk";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";

type Client = ReturnType<typeof useSession>["client"];

export function useKitchenGroup(orgId: string | null) {
  const { client } = useSession();
  return useApiQuery<SplitecoGroupResponse>(qk.kitchenSplitecoGroup(orgId ?? ""), () => wrap(() => client.spliteco.kitchenGroup(orgId!)), {
    enabled: !!orgId,
  });
}

/** Plain words for a refusal from spliteco-worker. */
export function moneyError(err: unknown): string {
  if (err instanceof CookpoolError) {
    const reason = err.details?.["reason"];
    if (reason === "over_settled") return "That's more than you owe them in the kitchen.";
    if (reason === "nothing_owed") return "There's nothing owed between you in the kitchen right now.";
    if (reason === "currency_mismatch") return "This kitchen counts in another currency.";
    if (reason === "not_in_group") return "Someone on it isn't in this kitchen any more.";
    if (err.status === 0) return "Can't reach Cookpool. Check your connection and try again.";
    if (err.message) return err.message;
  }
  return "Something went wrong. Try again.";
}

/** Add a bill in a kitchen: Cookpool's row on the Kitchen balance. */
export async function addKitchenBill(client: Client, orgId: string, request: SplitecoExpenseRequest, idempotencyKey: string): Promise<void> {
  try {
    await client.spliteco.createExpense(orgId, { ...request, bucket: "kitchen" }, { idempotencyKey });
  } catch (err) {
    throw new Error(moneyError(err));
  }
}

/** Pay someone in a kitchen: Kitchen only, never more than it (spliteco-worker refuses more). */
export async function payKitchen(
  client: Client,
  orgId: string,
  body: { toSubjectId: string; amountMinor: number; method: "upi" | "cash" | "bank"; note: string | null },
  idempotencyKey: string,
): Promise<void> {
  try {
    await client.spliteco.settle(orgId, { ...body, bucket: "kitchen" }, { idempotencyKey });
  } catch (err) {
    throw new Error(moneyError(err));
  }
}

/** A one-time, 60-second code that signs this person into Spliteco at `origin`. */
export async function handoffCode(client: Client, origin: string): Promise<string> {
  return (await client.auth.createHandoff({ targetOrigin: origin })).code;
}
