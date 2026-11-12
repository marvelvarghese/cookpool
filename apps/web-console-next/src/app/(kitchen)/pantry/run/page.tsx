"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ShoppingRun } from "@/components/kitchen/shopping-run-ui";
import { ListRun } from "@/components/kitchen/list-run-ui";
import { fromList } from "@/components/kitchen/shopping-list";

/**
 * The shopping run (cookpool-pantry PN-6, design §6.3): what was finished,
 * what is running low and what you usually buy, ticked and added in one
 * write (`ShoppingRun`). From the shopping list's Done shopping
 * (`?from=list`, cookpool-revamp RV-22) it is the list's run instead
 * (`ListRun`, the board RvShoppingRun). It exists only in the new frame:
 * today's frame sends its visitor to the Pantry.
 */
export default function ShoppingRunPage() {
  const shows = useNewFrameOnly("/pantry/run");
  // The query is read after mounting, so the page stays static.
  const [list, setList] = React.useState<boolean | null>(null);
  React.useEffect(() => setList(fromList(window.location.search)), []);
  if (!shows || list === null) return <Skeleton className="h-8 w-32" aria-hidden />;
  return list ? <ListRun /> : <ShoppingRun />;
}
