"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Receipt } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { AddBillForm } from "@saas/spliteco-ui/components";
import { SplitecoUiProvider } from "@saas/spliteco-ui/theme";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { CLOSE_44, K_CARD } from "./kit";
import { GroupPickerList } from "./group-picker";
import { refreshLedger } from "./ledger-data";
import { addKitchenBill, handoffCode, moneyError, useKitchenGroup } from "./kitchen-money-data";
import { COOKPOOL_SPLITECO_THEME } from "./spliteco-theme";
import { handoffUrl, splitecoOriginFor } from "./spliteco-link";
import { SPLITECO_LINE } from "./money-page";
import { BillScanPanel, useBillPrefill, useBillScan, useScanBillShows } from "./bill-scan-ui";

/**
 * Cookpool's kitchen money on Spliteco (cookpool-spliteco SE3, design §0.4,
 * §0.11, §4; the canvas's CookpoolMoney): for one kitchen at a time, the
 * Kitchen balance with its one button, Settle up, and its "why" — the shared
 * parts from `packages/spliteco-ui`, drawn in the revamp's look. Read from
 * spliteco-worker as Cookpool's view (`?bucket=kitchen`), so it never carries
 * the group's Other balance; a payment made in Spliteco shows here because
 * both apps write the one ledger.
 */

/** Cookpool's groups only: a group made in Spliteco (or a hidden direct one) is never listed here. */
export function kitchenGroupsOf<T extends Pick<PublicOrganization, "id"> & { madeIn?: string; kind?: string }>(groups: readonly T[]): T[] {
  return groups.filter((g) => g.madeIn !== "spliteco" && g.kind !== "direct");
}

/** Names by subject id from a kitchen read. */
export function namesOf(data: SplitecoGroupResponse | null): Map<string, string | null> {
  return new Map([...(data?.members ?? []), ...(data?.people ?? [])].map((p) => [p.subjectId, p.name] as const));
}

/**
 * "More in Spliteco" (design §0.4): what Spliteco adds that a kitchen doesn't
 * need, and one button that opens this kitchen there, already signed in — a
 * one-time 60-second code from identity-worker, exchanged on Spliteco's host —
 * with "← Back to Cookpool" to this very page.
 */
export function MoreInSpliteco({ orgId }: { orgId: string | null }) {
  const { client, target } = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function open() {
    if (busy) return;
    const origin = splitecoOriginFor(window.location.host, target.name);
    if (!origin) {
      toast({ kind: "error", title: "Spliteco isn't available here" });
      return;
    }
    setBusy(true);
    try {
      const code = await handoffCode(client, origin);
      window.location.assign(handoffUrl(origin, code, orgId, window.location.href));
    } catch (err) {
      setBusy(false);
      toast({ kind: "error", title: "Couldn't open Spliteco", description: moneyError(err) });
    }
  }

  return (
    <section aria-labelledby="money-spliteco" className={cn(K_CARD, "flex min-h-16 items-center gap-3 py-2.5 pl-4 pr-3")}>
      <span aria-hidden className="relative block h-6 w-[30px] shrink-0">
        <span className="absolute left-0 top-0.5 h-5 w-5 rounded-full border-[2.5px] border-primary" />
        <span className="absolute right-0 top-0.5 h-5 w-5 rounded-full bg-cp-accent-tint" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <h2 id="money-spliteco" className="text-[15px] font-medium leading-snug">
          More in Spliteco
        </h2>
        <span className="truncate text-[13px] font-normal text-muted-foreground">{SPLITECO_LINE}</span>
      </span>
      <Button
        variant="ghost"
        className="h-11 shrink-0 gap-1 rounded-[14px] px-3 text-sm font-medium text-cp-accent-text hover:bg-cp-accent-tint"
        onClick={() => void open()}
        loading={busy}
      >
        Open
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
      </Button>
    </section>
  );
}

/**
 * "+ Add a bill": which kitchen (straight on with one, or the one Money shows),
 * then the shared add-a-bill form, saved through spliteco-worker on the
 * Kitchen balance. Viewers' groups are left out.
 */
export function AddBillSheet({
  open,
  onOpenChange,
  groups,
  preferred,
  startScan = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly PublicOrganization[];
  preferred: string | null;
  /** Opened from Money's scan button: the form opens on Scan a bill's photo step. */
  startScan?: boolean;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) setPicked(groups.length === 1 ? groups[0]!.id : null);
  }, [open, groups]);
  const orgId = picked;
  const group = groups.find((g) => g.id === orgId) ?? null;
  const preferredSlug = groups.find((g) => g.id === preferred)?.slug ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-hidden rounded-t-[28px] border-x-0 bg-background px-4 pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="flex min-h-11 shrink-0 items-center gap-2 pr-12 text-[22px] font-medium">
          <Receipt className="h-5 w-5 text-cp-accent-text" aria-hidden />
          {group ? `Add a bill · ${group.name}` : "Which kitchen?"}
        </SheetTitle>
        <div className="-mx-4 mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {!group ? (
            groups.length === 0 ? (
              <p className={cn(K_CARD, "p-4 text-[15px] font-normal")}>No kitchen you can add to</p>
            ) : (
              <GroupPickerList
                groups={groups}
                value={preferredSlug}
                idPrefix="money-bill-kitchen"
                onPick={(slug) => setPicked(groups.find((g) => g.slug === slug)?.id ?? null)}
              />
            )
          ) : (
            <BillForm orgId={group.id} startScan={startScan} onDone={() => onOpenChange(false)} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BillForm({ orgId, startScan, onDone }: { orgId: string; startScan: boolean; onDone: () => void }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const profile = useProfile();
  const read = useKitchenGroup(orgId);
  const key = React.useRef<string>(crypto.randomUUID());
  const scanShows = useScanBillShows();
  const scan = useBillScan();
  const prefill = useBillPrefill(scan, read.data?.group.currency ?? "INR");
  const { open: openScan } = scan;
  // From the header's scan button: straight to the photo step, once.
  React.useEffect(() => {
    if (startScan && scanShows) openScan();
  }, [startScan, scanShows, openScan]);
  const formStart = React.useMemo(() => (prefill ? { title: prefill.title, amount: prefill.amount } : null), [prefill]);
  const me = profile.data?.id ?? null;
  if (read.loading || !me) return <Skeleton className="h-72 w-full rounded-[22px]" aria-hidden />;
  if (read.error || !read.data) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the kitchen.</p>;
  const data = read.data;
  const names = namesOf(data);
  const members = data.members.map((m) => ({ subjectId: m.subjectId, name: names.get(m.subjectId) ?? "Someone" }));
  return (
    <SplitecoUiProvider theme={COOKPOOL_SPLITECO_THEME}>
      <div className="mb-3.5 empty:hidden">
        <BillScanPanel scan={scan} prefill={prefill} shows={scanShows} />
      </div>
      <AddBillForm
        members={members}
        me={me}
        currency={data.group.currency}
        bucket="kitchen"
        idPrefix={`bill-${orgId}`}
        prefill={formStart}
        onSubmit={async (request) => {
          // Scan a bill (AI-15): the bill's own date when it wasn't today. Nothing was saved before this Save.
          const occurredAt = prefill?.occurredAt;
          await addKitchenBill(client, orgId, occurredAt ? { ...request, occurredAt } : request, key.current);
          key.current = crypto.randomUUID();
          refreshLedger(qc, orgId);
          toast({ kind: "success", title: "Bill added" });
          onDone();
        }}
      />
    </SplitecoUiProvider>
  );
}
