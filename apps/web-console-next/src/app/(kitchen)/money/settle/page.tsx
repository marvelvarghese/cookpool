"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { KitchenSettleScreen } from "@/components/kitchen/kitchen-settle-ui";

/**
 * Settle up in a kitchen (cookpool-spliteco SE3, the canvas's CookpoolSettle):
 * `/money/settle?group=org_…&to=usr_…`, from Money's Kitchen balance. The
 * shared Settle up (UPI, then "I paid"; or cash; or bank), recorded by
 * spliteco-worker on the Kitchen balance only. Money's page: the new frame only.
 */
export default function KitchenSettlePage() {
  const shows = useNewFrameOnly("/money/settle");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <KitchenSettleScreen />;
}
