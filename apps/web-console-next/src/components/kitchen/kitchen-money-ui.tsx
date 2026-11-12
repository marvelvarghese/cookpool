"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Receipt } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { AddBillForm, BalanceCard, WhyList } from "@saas/spliteco-ui/components";
import { balanceView } from "@saas/spliteco-ui/balance";
import { SplitecoUiProvider } from "@saas/spliteco-ui/theme";
import { whyRows, whySections } from "@saas/spliteco-ui/why";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { CLOSE_44, KCard, K_BUTTON, K_BUTTON_QUIET, K_CARD, K_SECTION } from "./kit";
import { GroupPickerList } from "./group-picker";
import { refreshLedger } from "./ledger-data";
import { addKitchenBill, handoffCode, moneyError, useKitchenGroup } from "./kitchen-money-data";
import { COOKPOOL_SPLITECO_THEME } from "./spliteco-theme";
import { MORE_IN_SPLITECO, handoffUrl, splitecoOriginFor } from "./spliteco-link";
import { useKitchenRouter } from "./transition-ui";

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
function namesOf(data: SplitecoGroupResponse | null): Map<string, string | null> {
  return new Map([...(data?.members ?? []), ...(data?.people ?? [])].map((p) => [p.subjectId, p.name] as const));
}

const CHIP = "inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Which kitchen: chips, one per group, when there is more than one. */
function KitchenChips({ groups, value, onPick }: { groups: readonly PublicOrganization[]; value: string; onPick: (id: string) => void }) {
  if (groups.length < 2) return null;
  return (
    <div role="tablist" aria-label="Kitchen" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {groups.map((g) => {
        const on = g.id === value;
        return (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(g.id)}
            className={cn(CHIP, on ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-cp-card")}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

export function KitchenMoney({ groups, orgId, onPick }: { groups: readonly PublicOrganization[]; orgId: string; onPick: (id: string) => void }) {
  const router = useKitchenRouter();
  const profile = useProfile();
  const me = profile.data?.id ?? null;
  const read = useKitchenGroup(orgId);
  const data = read.data;
  const names = React.useMemo(() => namesOf(data), [data]);
  const view = React.useMemo(() => (data ? balanceView(data, me, names) : null), [data, me, names]);
  const sections = React.useMemo(() => (data ? whySections(whyRows(data.expenses, me, names), new Date()) : []), [data, me, names]);

  return (
    <SplitecoUiProvider theme={COOKPOOL_SPLITECO_THEME}>
      <section aria-labelledby="money-kitchen" className="space-y-2.5">
        <h2 id="money-kitchen" className={K_SECTION}>
          Kitchen money
        </h2>
        <KitchenChips groups={groups} value={orgId} onPick={onPick} />
        {read.loading && !data ? (
          <div className="space-y-2.5" aria-hidden>
            <Skeleton className="h-36 w-full rounded-[22px]" />
            <Skeleton className="h-40 w-full rounded-[22px]" />
          </div>
        ) : read.error || !data || !view ? (
          <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load this kitchen&apos;s money.</p>
            <Button variant="outline" className={K_BUTTON} onClick={read.reload}>
              Try again
            </Button>
          </KCard>
        ) : (
          <div className="space-y-[22px]">
            <BalanceCard
              view={view}
              title={view.groupName}
              badge={
                <>
                  <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
                  powered by Spliteco
                </>
              }
              onSettle={(to) => router.push(`/money/settle?group=${encodeURIComponent(orgId)}&to=${encodeURIComponent(to.subjectId)}`)}
            />
            <WhyList sections={sections} title="Why" empty="Nothing in this kitchen's money yet" />
          </div>
        )}
      </section>
    </SplitecoUiProvider>
  );
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
    <section aria-labelledby="money-spliteco" className={cn(K_CARD, "flex flex-col gap-3 p-[18px]")}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="relative block h-6 w-[30px]">
          <span className="absolute left-0 top-0.5 h-5 w-5 rounded-full border-[2.5px] border-primary" />
          <span className="absolute right-0 top-0.5 h-5 w-5 rounded-full bg-cp-accent-tint" />
        </span>
        <h2 id="money-spliteco" className={K_SECTION}>
          More in Spliteco
        </h2>
      </div>
      <p className="text-[13px] font-normal leading-relaxed text-muted-foreground">Same account, same kitchen balance. Spliteco adds what a kitchen doesn&apos;t need:</p>
      <ul className="grid grid-cols-2 gap-2 text-[13px] font-normal">
        {MORE_IN_SPLITECO.map((t) => (
          <li key={t} className="rounded-xl bg-muted px-2.5 py-2.5">
            {t}
          </li>
        ))}
      </ul>
      <Button variant="ghost" className={cn(K_BUTTON_QUIET, "h-11 w-full gap-1.5")} onClick={() => void open()} loading={busy}>
        Open Spliteco
        <ArrowUpRight className="h-4 w-4" aria-hidden />
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly PublicOrganization[];
  preferred: string | null;
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
            <BillForm orgId={group.id} onDone={() => onOpenChange(false)} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BillForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const profile = useProfile();
  const read = useKitchenGroup(orgId);
  const key = React.useRef<string>(crypto.randomUUID());
  const me = profile.data?.id ?? null;
  if (read.loading || !me) return <Skeleton className="h-72 w-full rounded-[22px]" aria-hidden />;
  if (read.error || !read.data) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the kitchen.</p>;
  const data = read.data;
  const names = namesOf(data);
  const members = data.members.map((m) => ({ subjectId: m.subjectId, name: names.get(m.subjectId) ?? "Someone" }));
  return (
    <SplitecoUiProvider theme={COOKPOOL_SPLITECO_THEME}>
      <AddBillForm
        members={members}
        me={me}
        currency={data.group.currency}
        bucket="kitchen"
        idPrefix={`bill-${orgId}`}
        onSubmit={async (request) => {
          await addKitchenBill(client, orgId, request, key.current);
          key.current = crypto.randomUUID();
          refreshLedger(qc, orgId);
          toast({ kind: "success", title: "Bill added" });
          onDone();
        }}
      />
    </SplitecoUiProvider>
  );
}
