"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyScreen } from "@/components/kitchen/money-ui";

/**
 * Money (cookpool-recipes RC-2): the new frame's tab — your money, Settle up
 * and Bill, then People | Groups (`MoneyScreen`). It exists only in the new
 * frame: a prod visitor is sent Home.
 */
export default function MoneyPage() {
  const shows = useNewFrameOnly("/money");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyScreen />;
}
