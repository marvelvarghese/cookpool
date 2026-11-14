"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyPeople } from "@/components/kitchen/money-native-ui";

/** Money's People side (MY-21): `/money/people`, a route of its own so Back goes to Groups. */
export default function MoneyPeoplePage() {
  const shows = useNewFrameOnly("/money/people");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyPeople />;
}
