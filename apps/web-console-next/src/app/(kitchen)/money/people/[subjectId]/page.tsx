"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyPerson } from "@/components/kitchen/money-native-ui";
import { usePathParam } from "@/lib/page-param";

/** A person's page in Money (MY-21): `/money/people/<subject id>`, from a row on People. */
export default function MoneyPersonPage() {
  const shows = useNewFrameOnly("/money/people/:subjectId");
  const subjectId = decodeURIComponent(usePathParam("/money/people/:subjectId", "subjectId"));
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyPerson subjectId={subjectId} />;
}
