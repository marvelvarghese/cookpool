"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Settle up (CP-8) is part of People since SM-11: one screen with your money
 * per currency, the fewest payments with Record, and everyone you share a
 * group with. This address keeps working for the links that still use it
 * (Home's payments, a finalized dish, older bookmarks): it opens People, on
 * the group it named (`?group=`).
 */
export default function SettlePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const group = searchParams?.get("group") ?? null;

  React.useEffect(() => {
    router.replace(group ? `/people?group=${encodeURIComponent(group)}` : "/people", { scroll: false });
  }, [router, group]);

  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-24 w-full rounded-[22px]" />
      <Skeleton className="h-40 w-full rounded-[22px]" />
    </div>
  );
}
