"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyInside } from "@/components/kitchen/money-inside-ui";

/**
 * Money (cookpool-recipes RC-2; since money-inside MN-3, Spliteco inside):
 * the new frame's tab is Spliteco's own Money screens (`MoneyInside`), the
 * same as Tripeco's. It exists only in the new frame: a prod visitor is sent
 * Home.
 */
export default function MoneyPage() {
  const shows = useNewFrameOnly("/money");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyInside />;
}
