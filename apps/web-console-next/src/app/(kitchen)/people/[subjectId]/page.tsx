"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellRing, ChevronRight, HandCoins, Route, X } from "lucide-react";
import type { PersonGroupView, PersonViewResponse, SettlementMethod } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { GroupAvatar, KCard, K_BUTTON, SoonBadge } from "@/components/kitchen/kit";
import { Chip, KindBubble, Money } from "@/components/kitchen/ledger-ui";
import { TXN_KIND_META, relativeWhen } from "@/components/kitchen/activity";
import { formatMinor, formatSignedMinor } from "@/components/kitchen/money";
import { nameInitials, type MemberNames } from "@/components/kitchen/members";
import { refreshLedger, useOfferUndo } from "@/components/kitchen/ledger-data";
import { useMemberNames, usePerson } from "@/components/kitchen/people-data";
import { SETTLE_METHODS } from "@/components/kitchen/settle";
import {
  LINE_FILTERS,
  betweenSentence,
  filterLines,
  personHeadlines,
  personName,
  recordOptionSentence,
  recordOptions,
  recordRequest,
  shortcutSentence,
  type LineFilter,
  type RecordOption,
} from "@/components/kitchen/people";

/**
 * "You and Dev — why" (CP-9): what the two of you settle across every group
 * you share, with Record payment (a group picker when there are several,
 * then UPI · Cash · Bank) and Remind (soon); then, per group, every amount
 * behind it — the lines between you (filter: Everything · Dishes · Items
 * used · Bills), what you owe each other directly, the group shortcut in
 * words, and what the group's plan asks.
 */
export default function PersonPage() {
  const subjectId = safeDecode(usePathParam("/people/:subjectId", "subjectId"));
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const person = usePerson(subjectId);

  return (
    <div className="space-y-6">
      <Link
        href="/people"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        People
      </Link>

      {person.loading || profile.loading ? (
        <PersonSkeleton />
      ) : person.error?.code === "not_found" ? (
        <KCard className="flex flex-col items-center px-6 py-12 text-center">
          <h1 className="text-lg font-bold tracking-tight">
            {myId && subjectId === myId ? "That's you" : "You don't share a group with them"}
          </h1>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {myId && subjectId === myId
              ? "Pick someone you share a group with to see what's between you."
              : "They may have left your groups with nothing open between you."}
          </p>
          <Button asChild className={cn(K_BUTTON, "mt-5")}>
            <Link href="/people">Everyone you share a group with</Link>
          </Button>
        </KCard>
      ) : person.error || !person.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this person. {person.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={person.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <PersonView view={person.data} myId={myId} />
      )}
    </div>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function PersonView({ view, myId }: { view: PersonViewResponse; myId: string | null }) {
  const names = useMemberNames();
  const name = personName(view);
  const headlines = personHeadlines(view);
  const options = recordOptions(view, myId);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <span
          aria-hidden
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-cp-owed-tint text-lg font-extrabold text-cp-owed"
        >
          {nameInitials(name)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-tight">You and {name}</h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            In {view.groups.map((g) => g.name).join(" · ")}
          </p>
        </div>
      </header>

      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] min-[900px]:items-start">
        <div className="min-[900px]:sticky min-[900px]:top-6">
          <KCard className="p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Across the groups you share</h2>
            <ul className="mt-1 space-y-1">
              {headlines.map((h) => (
                <li
                  key={h.currency}
                  className={cn(
                    "text-[28px] font-extrabold leading-tight tracking-tight tabular-nums",
                    h.tone === "owed" ? "text-cp-owed" : h.tone === "owe" ? "text-cp-owe" : "",
                  )}
                >
                  {h.text}
                </li>
              ))}
            </ul>
            <RecordPayment view={view} name={name} myId={myId} options={options} />
          </KCard>
        </div>

        <div className="min-w-0 space-y-5">
          {view.groups.map((g) => (
            <WhyCard key={g.orgId} group={g} view={view} name={name} myId={myId} names={names} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Record payment ─────────────────────────────────────────────────

const METHOD_LABEL: Record<SettlementMethod, string> = { upi: "UPI", cash: "cash", bank: "bank transfer", other: "other" };

function RecordPayment({
  view,
  name,
  myId,
  options,
}: {
  view: PersonViewResponse;
  name: string;
  myId: string | null;
  options: RecordOption[];
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const offerUndo = useOfferUndo();
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<SettlementMethod | null>(null);
  const panelId = React.useId();
  // One group: nothing to pick.
  const option = options.length === 1 ? options[0]! : (options.find((o) => o.orgId === chosen) ?? null);
  const viewerOnly = options.length === 0 && view.groups.some((g) => g.planMinor !== 0);

  React.useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);

  const record = async (o: RecordOption, method: SettlementMethod) => {
    if (busy) return;
    setBusy(method);
    const r = await wrap(() => client.kitchen.createSettlement(o.orgId, recordRequest(o, method), { idempotencyKey: crypto.randomUUID() }));
    setBusy(null);
    refreshLedger(qc, o.orgId);
    if (!r.ok) {
      const description =
        r.error.reason === "not_in_group"
          ? `${name} has left ${o.groupName}. An owner or admin can undo their entries instead.`
          : r.error.message;
      toast({ kind: "error", title: "Couldn't record the payment", description });
      return;
    }
    setOpen(false);
    offerUndo(o.orgId, r.data.txn, "Payment recorded", `${recordOptionSentence(o, name, myId)}, by ${METHOD_LABEL[method]}.`);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          className={cn(K_BUTTON, "flex-1 whitespace-nowrap px-4")}
          disabled={options.length === 0}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <HandCoins aria-hidden />
          Record payment
        </Button>
        <Button variant="outline" className={cn(K_BUTTON, "flex-1 whitespace-nowrap px-4")} disabled aria-describedby={`${panelId}-remind`}>
          <BellRing aria-hidden />
          Remind
          <SoonBadge className="ml-0.5" />
        </Button>
      </div>
      <p id={`${panelId}-remind`} className="sr-only">
        Reminders arrive soon.
      </p>
      {viewerOnly ? (
        <p className="mt-2 text-xs text-muted-foreground">You view the groups where money is open, so you don&apos;t record payments in them.</p>
      ) : options.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing to record: you two are settled up.</p>
      ) : null}

      {open && options.length > 0 ? (
        <div id={panelId} className="mt-4 space-y-3 border-t pt-4">
          {options.length > 1 ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-muted-foreground">Which group is it in?</legend>
              <div className="space-y-2">
                {options.map((o) => (
                  <label
                    key={o.orgId}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                      chosen === o.orgId ? "border-primary bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${panelId}-group`}
                      value={o.orgId}
                      checked={chosen === o.orgId}
                      onChange={() => setChosen(o.orgId)}
                      className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold">{o.groupName}</span>
                      <span className="block text-sm tabular-nums text-muted-foreground">
                        {recordOptionSentence(o, name, myId).replace(` in ${o.groupName}`, "")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm font-semibold">{recordOptionSentence(options[0]!, name, myId)}</p>
          )}

          {option ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-xs font-medium text-muted-foreground" id={`${panelId}-how`}>
                How was it paid? Cookpool records it; the money moves in your UPI, bank or cash.
              </span>
              <div role="group" aria-labelledby={`${panelId}-how`} className="flex flex-wrap gap-2">
                {SETTLE_METHODS.map((m) => (
                  <Chip
                    key={m.id}
                    disabled={busy !== null}
                    selected={busy === m.id}
                    aria-busy={busy === m.id || undefined}
                    className={cn(busy === m.id && "animate-pulse disabled:opacity-100")}
                    onClick={() => void record(option, m.id)}
                  >
                    {m.label}
                  </Chip>
                ))}
              </div>
              <button
                type="button"
                aria-label="Cancel recording"
                disabled={busy !== null}
                onClick={() => setOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Why · {group} ──────────────────────────────────────────────────

function WhyCard({
  group,
  view,
  name,
  myId,
  names,
}: {
  group: PersonGroupView;
  view: PersonViewResponse;
  name: string;
  myId: string | null;
  names: MemberNames;
}) {
  const [filter, setFilter] = React.useState<LineFilter>("all");
  const lines = React.useMemo(() => filterLines(group.lines, filter), [group.lines, filter]);
  const [now] = React.useState(() => new Date());
  const shortcut = shortcutSentence(group, { meId: myId, otherId: view.subjectId, otherName: name, names });
  const filterLabel = LINE_FILTERS.find((f) => f.id === filter)?.label ?? "";
  const headingId = React.useId();

  return (
    <KCard className="p-5" aria-labelledby={headingId}>
      <div className="flex items-center gap-3">
        <GroupAvatar name={group.name} size="sm" />
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">
          Why · {group.name}
        </h2>
        <Link
          href={`/groups/${group.slug}?tab=balances`}
          className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-xl px-1 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Group
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      {group.lines.length > 0 ? (
        <div role="group" aria-label="Show" className="mt-3 flex flex-wrap gap-2">
          {LINE_FILTERS.map((f) => (
            <Chip
              key={f.id}
              aria-pressed={filter === f.id}
              selected={filter === f.id}
              className="px-3.5"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Chip>
          ))}
        </div>
      ) : null}

      {group.lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing between you two in {group.name} yet.</p>
      ) : lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing under {filterLabel} between you two.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {lines.map((l) => {
            const meta = TXN_KIND_META[l.kind];
            const owed = l.signedMinor > 0;
            return (
              <li key={`${l.txnId}:${l.signedMinor}`} className="flex min-h-14 items-center gap-3 py-2">
                <KindBubble glyph={meta.glyph} label={meta.label} tone={l.reversed ? "neutral" : meta.tone} className="h-9 w-9 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[15px] font-semibold", l.reversed && "text-muted-foreground line-through")}>
                    {l.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {l.reversed ? "Undone · " : ""}
                    {relativeWhen(l.occurredAt, now)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[15px] font-bold tabular-nums",
                    l.reversed ? "text-muted-foreground line-through" : owed ? "text-cp-owed" : "text-cp-owe",
                  )}
                >
                  <span aria-hidden>{formatSignedMinor(l.signedMinor, group.currency)}</span>
                  <span className="sr-only">
                    {owed ? `${name} owes you` : `you owe ${name}`} {formatMinor(Math.abs(l.signedMinor), group.currency)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="mt-3 space-y-2 border-t pt-3">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-sm text-muted-foreground">Between you two</dt>
          <dd
            className={cn(
              "text-right text-[15px] font-bold tabular-nums",
              group.pairwiseMinor > 0 ? "text-cp-owed" : group.pairwiseMinor < 0 ? "text-cp-owe" : "text-muted-foreground",
            )}
          >
            <span aria-hidden>{formatSignedMinor(group.pairwiseMinor, group.currency)}</span>
            <span className="sr-only">{betweenSentence(name, group)}</span>
          </dd>
        </div>
        {shortcut ? (
          <div className="rounded-xl bg-cp-herb-tint p-3 text-primary">
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-sm font-bold">
                <Route className="h-4 w-4 shrink-0" aria-hidden />
                Group shortcut
              </dt>
              <dd className="text-right text-[15px] font-bold tabular-nums">
                {formatSignedMinor(group.shortcutMinor, group.currency)}
              </dd>
            </div>
            <p className="mt-1 text-sm">{shortcut}.</p>
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3 border-t pt-2">
          <dt className="text-[15px] font-bold">
            {group.planMinor > 0 ? `${name} pays you` : group.planMinor < 0 ? `You pay ${name}` : "Nothing to pay"}
          </dt>
          <dd
            className={cn(
              "text-right text-lg font-extrabold tabular-nums",
              group.planMinor > 0 ? "text-cp-owed" : group.planMinor < 0 ? "text-cp-owe" : "text-muted-foreground",
            )}
          >
            <Money minor={Math.abs(group.planMinor)} currency={group.currency} />
          </dd>
        </div>
      </dl>
    </KCard>
  );
}

function PersonSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-40 w-full rounded-[20px]" />
      <Skeleton className="h-64 w-full rounded-[20px]" />
    </div>
  );
}
