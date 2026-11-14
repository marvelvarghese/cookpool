"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyAddGroup } from "@/components/kitchen/money-add-group-ui";

/** Add group, from Money's + Group and Add group row. MY-9 replaces this page. */
export default function MoneyAddGroupPage() {
  const shows = useNewFrameOnly("/money");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyAddGroup />;
}
