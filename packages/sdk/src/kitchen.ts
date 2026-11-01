import type {
  GetKitchenSettingsResponse,
  UpdateKitchenSettingsRequest,
  UpdateKitchenSettingsResponse,
} from "@saas/contracts/kitchen";

import type { RequestOptions, Transport } from "./transport.js";

/**
 * Kitchen resource client (Cookpool).
 *
 * Covers `apps/kitchen-worker` through the api-edge kitchen facade:
 * `/v1/organizations/:orgId/kitchen/…` for one group (and, as they land,
 * `/v1/kitchen/me/…` for the caller across every group).
 */
export class KitchenClient {
  constructor(private readonly transport: Transport) {}

  // -------------------------------------------------------------------------
  // Group settings
  // -------------------------------------------------------------------------

  /**
   * GET /v1/organizations/:orgId/kitchen/settings
   *
   * Any member. A group that never saved settings reads as INR /
   * `split_equally` with `updatedAt: null`.
   */
  getSettings(orgId: string, opts: RequestOptions = {}): Promise<GetKitchenSettingsResponse> {
    return this.transport.request<GetKitchenSettingsResponse>(
      {
        method: "GET",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/kitchen/settings`,
      },
      opts,
    );
  }

  /**
   * PATCH /v1/organizations/:orgId/kitchen/settings
   *
   * Owners and admins. The currency is fixed once the group has saved
   * settings: a different one is a `ConflictError` whose details carry
   * `reason: "currency_locked"` and the current `currency`.
   */
  updateSettings(
    orgId: string,
    body: UpdateKitchenSettingsRequest,
    opts: RequestOptions = {},
  ): Promise<UpdateKitchenSettingsResponse> {
    return this.transport.request<UpdateKitchenSettingsResponse>(
      {
        method: "PATCH",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/kitchen/settings`,
        body,
      },
      opts,
    );
  }
}
