"use client";

import { HandCoins } from "lucide-react";
import { KCard, PageHeader, IconBubble } from "@/components/kitchen/kit";

/** People (CP-5): an honest empty state until the ledger ships (CP2). */
export default function PeoplePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="People" subtitle="Everyone you share a group with, and where you stand." />

      <KCard className="flex flex-col items-center px-6 py-12 text-center">
        <IconBubble icon={HandCoins} tone="blue" className="h-14 w-14" />
        <h2 className="mt-4 text-lg font-bold tracking-tight">People and balances arrive with the ledger</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          You&apos;ll see what you and each person owe across every group you share, and every
          amount behind it.
        </p>
      </KCard>
    </div>
  );
}
