"use client";

import * as React from "react";
import Link from "./link";
import { Check, CookingPot, Package, Receipt, Trash2, Undo2 } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import { balanceView } from "@saas/spliteco-ui/balance";
import { whyRows } from "@saas/spliteco-ui/why";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { GroupAvatar, KCard, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { BackControl } from "./back-ui";
import { useKitchenGroup } from "./kitchen-money-data";
import { namesOf } from "./kitchen-money-ui";
import { copyLink } from "./recipe-share";
import { useKitchenRouter } from "./transition-ui";
import {
  WHY_ROWS,
  balanceLabel,
  groupWhyRows,
  moneyGroupHref,
  remindFor,
  settleHref,
  settleLine,
  signedWhole,
  wholeMoney,
  type MoneyWhyRow,
  type SettleSheetRow,
  type WhyKind,
} from "./money-page";

/**
 * One balance and its why (cookpool-revamp RV-17, the approved board
 * `RvMoneyGroup`): a group's, on Money (`/money?group=org_…`), and a
 * person's (`/people/[id]`, `NewPerson`, which reuses these parts). The big
 * figure from your view (blue + you get back, orange − you owe), the one main
 * button Settle up — it opens who pays whom, each row's Pay going to the one
 * settle path, `/money/settle` (spliteco-worker, Kitchen only), and Remind for
 * what they owe you — then Why: three rows, then See all.
 *
 * A group's numbers are spliteco-worker's Kitchen-only read (`?bucket=kitchen`,
 * the same read Settle up pays against), so what you see is what you pay.
 */

const TONE = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-muted-foreground" } as const;
const toneOf = (minor: number) => (minor > 0 ? TONE.owed : minor < 0 ? TONE.owe : TONE.settled);

/** A 44px quiet pill on the accent tint: Pay, Remind. */
export const MONEY_PILL = cn(K_BUTTON_QUIET, "h-11 shrink-0 px-3.5 text-sm");

/** The header: Back, the badge, the 26px name and one muted line. */
export function BalanceHeader({ onBack, badge, name, sub }: { onBack: () => void; badge: React.ReactNode; name: string; sub: string | null }) {
  return (
    <header className="flex items-center gap-2.5">
      <BackControl onClick={onBack} className="-ml-2.5" />
      {badge}
      <span className="flex min-w-0 flex-1 flex-col">
        <h1 className={cn(K_TITLE, "truncate leading-[1.1]")}>{name}</h1>
        {sub ? <span className="truncate text-[13px] font-normal text-muted-foreground">{sub}</span> : null}
      </span>
    </header>
  );
}

/**
 * The balance card: the label and the big signed figure (one per currency),
 * Settle up when anything is open, and under it, once opened, who pays whom.
 */
export function BalanceSection({
  nets,
  pays,
  back,
  viewOnly = false,
}: {
  nets: readonly { currency: string; minor: number }[];
  pays: readonly SettleSheetRow[];
  /** Where Settle up's Back and Done return. */
  back: string;
  /** Money is open only where you view: no Settle up. */
  viewOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const shown = nets.length > 0 ? nets : [{ currency: "INR", minor: 0 }];
  return (
    <section aria-label="Balance" className={cn(K_CARD, "flex flex-col gap-3.5 px-[18px] pb-[18px] pt-[22px]")}>
      <div className={cn("grid w-full gap-4", shown.length > 1 && "grid-cols-2")}>
        {shown.map((n) => (
          <p key={n.currency} className="flex min-w-0 flex-col items-center gap-3.5 text-center">
            <span className="text-sm font-normal text-muted-foreground">{balanceLabel(n.minor)}</span>
            <span className={cn("max-w-full truncate font-medium leading-none tracking-[-0.03em] tabular-nums", shown.length > 1 ? "text-[34px]" : "text-[48px]", toneOf(n.minor))}>
              {signedWhole(n.minor, n.currency)}
            </span>
          </p>
        ))}
      </div>
      {pays.length > 0 ? (
        <Button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} className="h-auto min-h-[54px] w-full rounded-2xl text-[17px] font-medium">
          Settle up
        </Button>
      ) : viewOnly ? (
        <p className="text-center text-sm font-normal text-muted-foreground">View only</p>
      ) : null}
      {open && pays.length > 0 ? (
        <ul id={panelId} aria-label="Who pays whom" className="flex flex-col divide-y divide-cp-line border-t border-cp-line">
          {pays.map((p) => (
            <li key={p.key}>
              <PayRow row={p} back={back} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** One payment: "You pay Dev ₹25" with Pay (the one settle path), or "Anu pays you ₹54" with Remind. */
export function PayRow({ row, back, group = false }: { row: SettleSheetRow; back: string; group?: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">
          {settleLine(row)} <span className={cn("tabular-nums", toneOf(row.minor))}>{wholeMoney(row.minor, row.currency)}</span>
        </span>
        {group ? <span className="block truncate text-[13px] font-normal text-muted-foreground">{row.groupName}</span> : null}
      </span>
      {row.minor < 0 ? (
        <Button asChild variant="ghost" className={MONEY_PILL}>
          <Link href={settleHref(row.orgId, row.subjectId, back)}>
            Pay<span className="sr-only"> {row.label} in {row.groupName}</span>
          </Link>
        </Button>
      ) : (
        <RemindButton name={row.label} owed={[{ minor: row.minor, currency: row.currency }]} />
      )}
    </div>
  );
}

/**
 * Remind: a short note in your words through the phone's share sheet, or
 * copied where there is none. Nothing is sent by the app and nothing in the
 * ledger changes.
 */
export function RemindButton({ name, owed }: { name: string; owed: readonly { minor: number; currency: string }[] }) {
  const { toast } = useToast();
  const remind = async () => {
    const text = remindFor(name, owed);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ text }).catch(() => undefined);
      return;
    }
    const ok = await copyLink(text, typeof navigator !== "undefined" ? navigator.clipboard : null);
    toast(ok ? { kind: "success", title: "Reminder copied" } : { kind: "error", title: "Couldn't copy the reminder" });
  };
  return (
    <Button variant="ghost" className={MONEY_PILL} onClick={() => void remind()}>
      Remind
    </Button>
  );
}

const KIND_ICON: Record<WhyKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  bill: Receipt,
  dish: CookingPot,
  use: Package,
  waste: Trash2,
  paid: Check,
  undo: Undo2,
};

/** Why: what makes up the balance, newest first, three rows, then See all in place. */
export function WhyCard({ rows, empty }: { rows: readonly MoneyWhyRow[]; empty: string }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, WHY_ROWS);
  return (
    <section aria-labelledby="money-why" className="space-y-2.5">
      <h2 id="money-why" className={K_SECTION}>
        Why
      </h2>
      {rows.length === 0 ? (
        <p className={cn(K_CARD, "flex min-h-14 items-center px-4 text-sm font-normal text-muted-foreground")}>{empty}</p>
      ) : (
        <div className={K_ROWS}>
          <ul className="divide-y divide-cp-line">
            {shown.map((r) => (
              <li key={r.id}>
                <WhyRowView row={r} />
              </li>
            ))}
          </ul>
          {rows.length > WHY_ROWS ? (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll(!all)}
              className="min-h-12 w-full text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {all ? "Show less" : "See all"}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function WhyRowView({ row }: { row: MoneyWhyRow }) {
  const Icon = KIND_ICON[row.kind];
  const paid = row.kind === "paid";
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-4">
      <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", paid ? "bg-cp-accent-tint text-cp-accent-text" : "bg-secondary text-muted-foreground")}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={cn("truncate text-base font-medium", row.reversed && "text-muted-foreground line-through")}>{row.title}</span>
        <span className="truncate text-[13px] font-normal text-muted-foreground">{row.fact}</span>
      </span>
      <span className={cn("shrink-0 text-[15px] font-medium tabular-nums", row.reversed ? "text-muted-foreground line-through" : toneOf(row.minor))}>
        {signedWhole(row.minor, row.currency)}
      </span>
    </div>
  );
}

/** A group's balance and its why, on Money (`/money?group=org_…`). */
export function MoneyGroupScreen({ group }: { group: PublicOrganization }) {
  const router = useKitchenRouter();
  const profile = useProfile();
  const me = profile.data?.id ?? null;
  const read = useKitchenGroup(group.id);
  const data = read.data;
  const [now] = React.useState(() => new Date());
  const names = React.useMemo(() => namesOf(data ?? null), [data]);
  const view = React.useMemo(() => (data ? balanceView(data, me, names) : null), [data, me, names]);
  const why = React.useMemo(() => {
    if (!data) return [];
    const kinds = new Map(data.expenses.map((e) => [e.id, e.kind] as const));
    return groupWhyRows(whyRows(data.expenses, me, names), kinds, now);
  }, [data, me, names, now]);
  const pays: SettleSheetRow[] = React.useMemo(
    () =>
      view && view.canWrite
        ? view.rows
            .filter((r) => r.amountMinor !== 0)
            .map((r) => ({ key: r.subjectId, orgId: group.id, groupName: group.name, subjectId: r.subjectId, label: r.name, minor: r.amountMinor, currency: view.currency }))
        : [],
    [view, group.id, group.name],
  );
  const back = React.useCallback(() => router.replace("/money", { scroll: false }), [router]);
  const count = data?.group.memberCount ?? null;

  return (
    <div className="space-y-[22px] min-[900px]:max-w-2xl">
      <BalanceHeader
        onBack={back}
        badge={<GroupAvatar name={group.name} id={group.id} className="h-[42px] w-[42px] rounded-[14px]" />}
        name={group.name}
        sub={count === null ? null : `${count} ${count === 1 ? "person" : "people"}`}
      />
      {read.loading && !data ? (
        <div className="space-y-[22px]" aria-hidden>
          <Skeleton className="h-[180px] w-full rounded-[22px]" />
          <Skeleton className="h-48 w-full rounded-[22px]" />
        </div>
      ) : read.error || !data || !view ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this kitchen&apos;s money.</p>
          <Button variant="ghost" className={MONEY_PILL} onClick={read.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <>
          <BalanceSection
            nets={[{ currency: view.currency, minor: view.myBalanceMinor }]}
            pays={pays}
            back={moneyGroupHref(group.id)}
            viewOnly={!view.canWrite && view.rows.some((r) => r.amountMinor !== 0)}
          />
          <WhyCard rows={why} empty="Nothing in this kitchen's money yet" />
        </>
      )}
    </div>
  );
}
