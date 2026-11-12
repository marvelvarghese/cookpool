import {
  KITCHEN_INTERNAL_ACTOR_HEADER,
  type KitchenInternalActor,
  type SubjectBalanceResponse,
} from "@saas/contracts/kitchen";
import { orgPublicId } from "./ids.js";

// A person's balance in a group, from kitchen-worker's service-internal route
// (GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance, CP-19)
// over the KITCHEN_WORKER binding. Leaving a group is refused while either of
// its two balances — Kitchen, or Other (what was added in Spliteco,
// cookpool-spliteco SE3) — is not zero (risks CP-L). Anything but a well-formed answer — no binding, a failed
// fetch, a non-2xx status, a malformed body — is `{ ok: false }`: the caller
// cannot tell, and refuses rather than let someone leave owing.

const CALLER: KitchenInternalActor = "membership-worker";

export type KitchenBalanceResult = ({ ok: true } & SubjectBalanceResponse) | { ok: false };

export async function fetchKitchenBalance(
  kitchenWorker: Fetcher | undefined,
  orgId: string,
  subjectId: string,
  requestId: string,
): Promise<KitchenBalanceResult> {
  if (!kitchenWorker) return { ok: false };
  let response: Response;
  try {
    response = await kitchenWorker.fetch(
      `http://kitchen-worker/v1/internal/kitchen/organizations/${orgPublicId(orgId)}/subjects/${encodeURIComponent(subjectId)}/balance`,
      { method: "GET", headers: { "x-request-id": requestId, [KITCHEN_INTERNAL_ACTOR_HEADER]: CALLER } },
    );
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false };
  }
  const data = (parsed as { data?: Partial<SubjectBalanceResponse> } | null)?.data;
  if (!data || !Number.isSafeInteger(data.balanceMinor) || typeof data.currency !== "string") return { ok: false };
  // The Other balance (cookpool-spliteco SE3). A kitchen-worker from before
  // SE3 sends none: its balanceMinor is then the whole ledger, both balances.
  if (data.otherMinor !== undefined && !Number.isSafeInteger(data.otherMinor)) return { ok: false };
  return { ok: true, balanceMinor: data.balanceMinor!, otherMinor: data.otherMinor ?? 0, currency: data.currency };
}
