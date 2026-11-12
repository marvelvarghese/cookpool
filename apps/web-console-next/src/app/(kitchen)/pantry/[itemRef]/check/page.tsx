"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import type { KitchenItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_BUTTON_QUIET } from "@/components/kitchen/kit";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { useGroupRole } from "@/components/kitchen/ledger-data";
import { useMemberNames } from "@/components/kitchen/people-data";
import { useKitchenItem } from "@/components/kitchen/pantry-data";
import { itemRefParam, parseItemRef, type ItemRef } from "@/components/kitchen/pantry";
import { StockCheckScreen } from "@/components/kitchen/stock-check-ui";

/**
 * Fix how much is left (cookpool-pantry PN-7, design §7): the stock check
 * of one item, from its page. The address names the item as its page's does
 * (`/pantry/me:itm_…/check`, `/pantry/org:org_…:itm_…/check`), read from the
 * address (SM-2: one prerendered file serves every item). It exists only in
 * the new frame: a prod visitor is sent to the Pantry.
 */
export default function StockCheckPage() {
  const shows = useNewFrameOnly("/pantry/:itemRef/check");
  const ref = parseItemRef(usePathParam("/pantry/:itemRef/check", "itemRef"));
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  if (!ref) return <CheckNotFound />;
  return <CheckLoader key={itemRefParam(ref)} itemRef={ref} />;
}

function CheckLoader({ itemRef }: { itemRef: ItemRef }) {
  const profile = useProfile();
  const item = useKitchenItem(itemRef);
  if (item.loading || profile.loading) return <CheckSkeleton />;
  if (item.error?.code === "not_found" || item.data?.state === "removed") return <CheckNotFound />;
  if (item.error || !item.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this item. {item.error?.message ?? ""}</p>
        <Button variant="ghost" className={K_BUTTON_QUIET} onClick={item.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const meId = profile.data?.id ?? null;
  return itemRef.kind === "group" ? (
    <GroupCheck itemRef={itemRef} item={item.data} meId={meId} />
  ) : (
    <PersonalCheck itemRef={itemRef} item={item.data} meId={meId} />
  );
}

function GroupCheck({ itemRef, item, meId }: { itemRef: ItemRef & { kind: "group" }; item: KitchenItem; meId: string | null }) {
  const { members, roleKnown, canWrite } = useGroupRole(itemRef.orgId, meId);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  if (!roleKnown) return <CheckSkeleton />;
  return <StockCheckScreen itemRef={itemRef} item={item} meId={meId} names={names} roster={roster} canWrite={canWrite} />;
}

function PersonalCheck({ itemRef, item, meId }: { itemRef: ItemRef; item: KitchenItem; meId: string | null }) {
  const names = useMemberNames();
  return <StockCheckScreen itemRef={itemRef} item={item} meId={meId} names={names} roster={null} canWrite />;
}

function CheckNotFound() {
  return (
    <KCard className="flex flex-col items-center px-6 py-12 text-center">
      <h1 className="text-lg font-medium tracking-tight">This item isn&apos;t in a pantry you can see</h1>
      <Button asChild className={cn(K_BUTTON, "mt-5")}>
        <Link href="/pantry">Back to Kitchen</Link>
      </Button>
    </KCard>
  );
}

function CheckSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-[296px] w-full rounded-[22px]" />
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  );
}
