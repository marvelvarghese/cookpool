"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ShoppingListPage } from "@/components/kitchen/shopping-list-ui";

/**
 * The shopping list (cookpool-revamp RV-21): every pantry's staples running
 * low or out and the lines added by hand (`ShoppingListPage`). It exists only
 * in the new frame: today's frame sends its visitor to the Pantry.
 */
export default function ShoppingListRoute() {
  const shows = useNewFrameOnly("/pantry/list");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <ShoppingListPage />;
}
