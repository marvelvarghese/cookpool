"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Clock, Plus, Refrigerator } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IconBubble, KCard, K_BUTTON } from "./kit";
import { useProfile } from "./data";
import { useMemberNames } from "./people-data";
import { usePantries, usePantryItems, useUseSoonItems } from "./pantry-data";
import { UseByPill } from "./pantry-ui";
import { memberLabelInline } from "./members";
import { HOME_USE_SOON, expiryChip, itemHref, itemRefOf, leftText, pantryLabel, soonStrip, totalsOf } from "./pantry";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { isPendingId } from "@/lib/optimistic";

/**
 * The pantry outside /pantry (CP-12): Home's "Use soon" strip — the soonest
 * items to use, then those past their date, each opening its page — and a
 * group's Pantry tab, a short list of what the group holds with a link to the
 * whole pantry.
 */

export function HomeUseSoon({ exclude, className }: { exclude?: ReadonlySet<string>; className?: string } = {}) {
  const strip = useUseSoonItems();
  const prefetch = usePrefetchKitchen();
  const pantries = usePantries();
  const items = strip.data ? soonStrip(strip.data.soon, strip.data.expired, HOME_USE_SOON, exclude) : null;
  const total = pantries.data ? totalsOf(pantries.data).itemCount : null;
  // Everything due soon is already a card in Needs you.
  const allInInbox = items !== null && items.length === 0 && (exclude?.size ?? 0) > 0;

  return (
    <section aria-labelledby="home-soon" className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h2 id="home-soon" className="text-lg font-bold tracking-tight">
          Use soon
        </h2>
        <Link
          href={items && items.length > 0 ? "/pantry?filter=soon" : "/pantry"}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All pantries
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      {strip.loading ? (
        <div className="flex gap-3" aria-hidden>
          <Skeleton className="h-28 w-36 rounded-[18px]" />
          <Skeleton className="h-28 w-36 rounded-[18px]" />
          <Skeleton className="h-28 w-36 rounded-[18px]" />
        </div>
      ) : strip.error || !items ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load what to use soon. {strip.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={strip.reload}>
            Try again
          </Button>
        </KCard>
      ) : allInInbox ? (
        <KCard className="flex gap-4 p-5">
          <IconBubble icon={Clock} tone="neutral" />
          <p className="min-w-0 self-center text-sm text-muted-foreground">Everything due soon is in Needs you.</p>
        </KCard>
      ) : items.length === 0 ? (
        <KCard className="flex gap-4 p-5">
          <IconBubble icon={total === 0 ? Refrigerator : Clock} tone={total === 0 ? "green" : "neutral"} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold tracking-tight">
              {total === 0 ? "Add what you buy" : "Nothing to use up in the next few days"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 0
                ? "Put it in your own pantry or a group's, and Cookpool shows what to use first."
                : "Items close to their use-by date show here first."}
            </p>
            {total === 0 ? (
              <Button asChild className={cn(K_BUTTON, "mt-3")}>
                <Link href="/pantry/new">
                  <Plus aria-hidden />
                  Add an item
                </Link>
              </Button>
            ) : null}
          </div>
        </KCard>
      ) : (
        <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 min-[900px]:mx-0 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:overflow-visible min-[900px]:px-0 min-[900px]:pb-0">
          {items.map((item) => {
            const chip = expiryChip(item);
            const expired = chip?.tone === "expired";
            return (
              <li key={item.id} className="w-36 shrink-0 snap-start min-[900px]:w-auto">
                <Link
                  {...pressIn(() => prefetch.item(itemRefOf(item)))}
                  href={itemHref(item)}
                  className="flex h-full min-h-28 flex-col gap-1.5 rounded-[18px] border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {chip ? <UseByPill chip={chip} className="self-start" /> : null}
                  <span className={cn("line-clamp-2 text-[15px] font-bold leading-snug", expired && "text-muted-foreground line-through")}>
                    {item.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {leftText(item)} · {pantryLabel(item.pantry)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Items the group's Pantry tab lists before "Open the pantry". */
const GROUP_TAB_ROWS = 6;

export function GroupPantryPanel({ orgId, name, canWrite }: { orgId: string; name: string; canWrite: boolean }) {
  const items = usePantryItems(orgId);
  const profile = useProfile();
  const names = useMemberNames();
  const meId = profile.data?.id ?? null;
  const list = items.data?.items ?? null;
  const pantryHref = `/pantry?pantry=${encodeURIComponent(orgId)}`;
  const addHref = `/pantry/new?pantry=${encodeURIComponent(orgId)}`;

  if (items.loading || (!items.data && !items.error)) {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-16 w-full rounded-[18px]" />
        <Skeleton className="h-16 w-full rounded-[18px]" />
      </div>
    );
  }
  if (items.error || !list) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the pantry. {items.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={items.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (list.length === 0) {
    return (
      <KCard className="flex gap-4 p-5">
        <IconBubble icon={Refrigerator} tone="neutral" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold tracking-tight">Nothing in the group pantry yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            What the group buys shows here, soonest to use first. Nobody is charged until someone uses some.
          </p>
          {canWrite ? (
            <Button asChild className={cn(K_BUTTON, "mt-3")}>
              <Link href={addHref}>
                <Plus aria-hidden />
                Add to {name}
              </Link>
            </Button>
          ) : null}
        </div>
      </KCard>
    );
  }
  return (
    <div className="space-y-2.5">
      <ul className="divide-y rounded-[18px] border bg-card">
        {list.slice(0, GROUP_TAB_ROWS).map((item) => {
          const chip = expiryChip(item);
          return (
            <li key={item.id} aria-busy={isPendingId(item.id) || undefined}>
              <Link
                href={itemHref(item)}
                // Just added (SM-5): listed at once, opened once the server has it.
                onClick={(e) => {
                  if (isPendingId(item.id)) e.preventDefault();
                }}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-[18px] last:rounded-b-[18px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-bold", chip?.tone === "expired" && "text-muted-foreground line-through")}>
                    {item.name}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {leftText(item)} left · {memberLabelInline(item.paidBy, meId, names)} paid
                  </span>
                </span>
                {chip ? <UseByPill chip={chip} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className={cn("grid gap-2", canWrite ? "grid-cols-2" : "grid-cols-1")}>
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href={pantryHref}>{list.length > GROUP_TAB_ROWS ? `All ${list.length} items` : `Open the ${name} pantry`}</Link>
        </Button>
        {canWrite ? (
          <Button asChild variant="outline" className={K_BUTTON}>
            <Link href={addHref}>
              <Plus aria-hidden />
              Add
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
