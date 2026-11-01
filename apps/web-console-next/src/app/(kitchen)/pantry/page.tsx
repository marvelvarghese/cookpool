"use client";

import { Clock, Refrigerator, ShoppingBasket } from "lucide-react";
import { ComingSoonCard, KCard, PageHeader, IconBubble } from "@/components/kitchen/kit";

/** Pantry (CP-5): an honest empty state until pantries ship (CP3). */
export default function PantryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Pantry" subtitle="Your own pantry and every group pantry you share." />

      <KCard className="flex flex-col items-center px-6 py-12 text-center">
        <IconBubble icon={Refrigerator} className="h-14 w-14" />
        <h2 className="mt-4 text-lg font-bold tracking-tight">Pantries arrive next</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          You&apos;ll add what you buy, see what to use first, and log what you use — in your own
          pantry or a group&apos;s. Your own pantry stays yours in every group you join.
        </p>
      </KCard>

      <div className="grid gap-3 min-[640px]:grid-cols-2">
        <ComingSoonCard
          icon={ShoppingBasket}
          title="Add what you bought"
          body="Who paid, how much, and when to use it by."
          tone="green"
        />
        <ComingSoonCard
          icon={Clock}
          title="Use it before it goes"
          body="Items close to their use-by date, first."
          tone="neutral"
        />
      </div>
    </div>
  );
}
