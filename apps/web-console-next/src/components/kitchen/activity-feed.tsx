"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Flag, MoreVertical, Undo2 } from "lucide-react";
import type { ActivityPage, KitchenTxn } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { SkeletonRow } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CLOSE_44, KCard, K_BUTTON } from "./kit";
import { KindBubble } from "./ledger-ui";
import { activityRow, flattenActivity, withTxnReversed, type ActivityRow } from "./activity";
import { refreshLedger, useActivityFeed, useOfferUndo } from "./ledger-data";
import { useMemberNames } from "./people-data";

/**
 * A group's Activity (CP-8): every entry newest first, a page at a time.
 * Each row shows the kind, title, who logged it and when, and what it did to
 * *your* balance (blue +, orange −, neutral) — a payment, the money that
 * moved (SM-11: "Anu paid you" is +). Undone entries are struck through.
 * `?txn=txn_…` (Home's flag cards and Recent activity, CP-23) brings that
 * entry into view and marks it, reading a few more pages to find it. The row
 * menu offers Undo (its creator, or an owner or admin) and Flag (someone it
 * names); a viewer gets neither. With `limit` (the group's page), the first
 * rows and "See all".
 */
export function ActivityFeed({
  orgId,
  meId,
  canReverseAny,
  canWrite = true,
  limit,
}: {
  orgId: string;
  /** Unused since SM-11 (the empty feed no longer repeats the page's Add a bill). */
  slug?: string;
  meId: string | null;
  canReverseAny: boolean;
  /** False for a viewer (CP-9). */
  canWrite?: boolean;
  /** Rows shown before "See all"; every row when left out. */
  limit?: number;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const offerUndo = useOfferUndo();
  const names = useMemberNames();
  const feed = useActivityFeed(orgId);
  const [flagging, setFlagging] = React.useState<KitchenTxn | null>(null);
  // "When" is relative to the moment the page rendered; refreshed every minute.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const txns = React.useMemo(() => flattenActivity(feed.data?.pages ?? []), [feed.data]);
  const [expanded, setExpanded] = React.useState(false);

  // The entry a link points at (`?txn=`): into view once listed, else a few more pages.
  const focusTxn = useSearchParams()?.get("txn") ?? null;
  const all = !limit || expanded || focusTxn !== null;
  const shown = all ? txns : txns.slice(0, limit);
  const focusListed = focusTxn !== null && txns.some((t) => t.id === focusTxn);
  const pagesRead = feed.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  React.useEffect(() => {
    if (!focusTxn) return;
    if (focusListed) {
      document.getElementById(`txn-${focusTxn}`)?.scrollIntoView({ block: "center" });
      return;
    }
    if (pagesRead > 0 && pagesRead < FOCUS_MAX_PAGES && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [focusTxn, focusListed, pagesRead, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /**
   * Undo: strike the row through at once, then post the reversal; if that
   * fails, put the row back. Done, a toast offers to undo the undo.
   */
  const undo = async (txn: KitchenTxn) => {
    const key = qk.kitchenActivity(orgId);
    await qc.cancelQueries({ queryKey: key });
    const before = qc.getQueryData<InfiniteData<ActivityPage>>(key);
    qc.setQueryData<InfiniteData<ActivityPage>>(key, (d) => (d ? withTxnReversed(d, txn.id) : d));
    const r = await wrap(() => client.kitchen.reverseTxn(orgId, txn.id, {}, { idempotencyKey: crypto.randomUUID() }));
    if (!r.ok) {
      qc.setQueryData(key, before);
      if (r.error.reason === "already_reversed") {
        toast({ kind: "warning", title: "Already undone", description: "Someone undid it a moment ago." });
        refreshLedger(qc, orgId);
      } else if (r.error.reason === "not_creator") {
        toast({ kind: "error", title: "You can't undo this", description: "Only whoever logged it, or an owner or admin, can." });
      } else {
        toast({ kind: "error", title: "Couldn't undo it", description: r.error.message });
      }
      return;
    }
    refreshLedger(qc, orgId);
    offerUndo(orgId, r.data.txn, `Undone: ${txn.title}`);
  };

  if (feed.isLoading) {
    return (
      <KCard className="px-4" aria-hidden>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </KCard>
    );
  }
  if (feed.isError && txns.length === 0) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the activity. {feed.error?.message}</p>
        <Button variant="outline" className={K_BUTTON} onClick={() => void feed.refetch()}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (txns.length === 0) {
    return <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">Nothing yet</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-[22px] border bg-card">
        {shown.map((txn) => {
          const row = activityRow(txn, { meId, canReverseAny, now, names, canWrite });
          return (
            <ActivityItem
              key={txn.id}
              row={row}
              focused={txn.id === focusTxn}
              onUndo={() => void undo(txn)}
              onFlag={() => setFlagging(txn)}
            />
          );
        })}
      </ul>

      {!all && txns.length > shown.length ? (
        <Button variant="ghost" className={cn(K_BUTTON, "w-full text-primary")} onClick={() => setExpanded(true)}>
          See all
        </Button>
      ) : feed.hasNextPage ? (
        <Button
          variant="outline"
          className={cn(K_BUTTON, "w-full bg-card")}
          loading={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          Load more
        </Button>
      ) : txns.length > 10 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">That&apos;s everything.</p>
      ) : null}

      <FlagDialog orgId={orgId} txn={flagging} onClose={() => setFlagging(null)} />
    </div>
  );
}

/** How many pages the feed reads looking for a linked entry. */
const FOCUS_MAX_PAGES = 4;

function ActivityItem({ row, focused, onUndo, onFlag }: { row: ActivityRow; focused: boolean; onUndo: () => void; onFlag: () => void }) {
  const hasMenu = row.canUndo || row.canFlag;
  const amountClass =
    row.reversed || row.tone === "neutral"
      ? "text-muted-foreground"
      : row.tone === "owed"
        ? "text-cp-owed"
        : "text-cp-owe";
  return (
    <li
      id={`txn-${row.id}`}
      aria-current={focused ? "true" : undefined}
      className={cn("flex min-h-[60px] scroll-mt-24 items-center gap-3 px-4 py-2", focused && "bg-cp-soon-tint/60")}
    >
      <KindBubble glyph={row.glyph} label={row.kindLabel} tone={row.reversed ? "neutral" : row.kindTone} className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[15px] font-semibold leading-snug", row.reversed && "text-muted-foreground line-through")}>
          {row.title}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {row.reversed ? (
            <span className="mr-1.5 inline-block rounded-full bg-muted px-2 py-px align-[1px] text-[11px] font-semibold uppercase tracking-wide">
              Undone
            </span>
          ) : null}
          {row.whoWhen}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {row.amountText ? (
          <p className={cn("text-[15px] font-bold tabular-nums", amountClass, row.reversed && "line-through")}>
            <span aria-hidden>{row.amountText}</span>
            <span className="sr-only">{row.amountWords}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">not involved</p>
        )}
        <p className="text-xs tabular-nums text-muted-foreground">
          <span className="sr-only">Total </span>
          {row.totalText}
        </p>
      </div>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${row.title}`}
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreVertical className="h-5 w-5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44 rounded-xl p-1.5">
            {row.canUndo ? (
              <DropdownMenuItem onSelect={onUndo} className="min-h-11 rounded-lg px-3 text-[15px]">
                <Undo2 className="h-4 w-4" aria-hidden />
                Undo
              </DropdownMenuItem>
            ) : null}
            {row.canFlag ? (
              <DropdownMenuItem onSelect={onFlag} className="min-h-11 rounded-lg px-3 text-[15px]">
                <Flag className="h-4 w-4" aria-hidden />
                Flag
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span aria-hidden className="-mr-2 w-11 shrink-0" />
      )}
    </li>
  );
}

const FLAG_REASON_MAX = 500;

/** "This looks wrong": a reason, posted as a flag on the entry. */
function FlagDialog({ orgId, txn, onClose }: { orgId: string; txn: KitchenTxn | null; onClose: () => void }) {
  const { client } = useSession();
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (txn) {
      setReason("");
      setError(null);
    }
  }, [txn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txn) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Say what looks wrong");
      return;
    }
    setBusy(true);
    const r = await wrap(() =>
      client.kitchen.flagTxn(orgId, txn.id, { reason: trimmed }, { idempotencyKey: crypto.randomUUID() }),
    );
    setBusy(false);
    if (!r.ok) {
      setError(
        r.error.reason === "not_a_party" ? "Only someone this entry names can flag it." : r.error.message,
      );
      return;
    }
    onClose();
    toast({
      kind: "success",
      title: "Flagged",
      description: "It's saved on the entry. A fix is an undo and a new entry.",
    });
  };

  return (
    <Dialog open={txn !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[22px] sm:max-w-md", CLOSE_44)}>
        <DialogHeader>
          <DialogTitle className="pr-10 text-xl font-extrabold">Flag &ldquo;{txn?.title}&rdquo;</DialogTitle>
          <DialogDescription>Tell whoever logged it what looks wrong.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="flag-reason">What looks wrong?</Label>
            <Textarea
              id="flag-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              maxLength={FLAG_REASON_MAX}
              rows={4}
              placeholder="e.g. I wasn't there for this dinner"
              aria-invalid={!!error}
              aria-describedby={error ? "flag-reason-error" : undefined}
              className="rounded-xl text-base sm:text-[15px]"
            />
            {error ? (
              <p id="flag-reason-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className={K_BUTTON} disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={K_BUTTON} loading={busy}>
              Flag it
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
