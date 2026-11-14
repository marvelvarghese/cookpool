"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyManageGroup } from "@/components/kitchen/money-manage-ui";

/** Manage group (money-native MY-11): `/money/group?id=org_…`, from a group on Money's list. */
export default function MoneyGroupPage() {
  const shows = useNewFrameOnly("/money/group");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyManageGroup />;
}
