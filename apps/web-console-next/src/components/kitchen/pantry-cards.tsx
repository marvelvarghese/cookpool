"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Refrigerator } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IconBubble, KCard, K_BUTTON } from "./kit";
import { useProfile } from "./data";
import { useMemberNames } from "./people-data";
import { usePantryItems } from "./pantry-data";
import { UseByPill } from "./pantry-ui";
import { memberLabelInline } from "./members";
import { expiryChip, itemHref, leftText } from "./pantry";
import { isPendingId } from "@/lib/optimistic";

/**
 * The pantry outside /pantry (CP-12): a group's Pantry tab, a short list of
 * what the group holds with a link to the whole pantry. (Home's "Use soon"
 * strip is gone since SM-10: food to use soon is one of Home's to-dos, and
 * the rest is Pantry's Soon chip.)
 */

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
