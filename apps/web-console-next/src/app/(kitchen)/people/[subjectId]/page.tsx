"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, X } from "lucide-react";
import type { PersonGroupView, PersonViewResponse, SettlementMethod } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { Face, MAIN_BUTTON, MainButtonLabel } from "@/components/kitchen/faces-ui";
import { Chip } from "@/components/kitchen/ledger-ui";
import { relativeWhen } from "@/components/kitchen/activity";
import { formatMinor, formatSignedMinor } from "@/components/kitchen/money";
import type { MemberNames } from "@/components/kitchen/members";
import { useRecordPayment } from "@/components/kitchen/settle-card";
import { useMemberNames, usePerson } from "@/components/kitchen/people-data";
import { SETTLE_METHODS } from "@/components/kitchen/settle";
import {
  betweenSentence,
  firstName,
  personMoney,
  personName,
  planSentence,
  recordOptionSentence,
  recordOptions,
  shortcutPlain,
  type PersonMoneyLine,
  type RecordOption,
} from "@/components/kitchen/people";

/**
 * A person (CP-9; SM-11 under the seven rules): their face and name, what
 * the two of you settle — one headline per currency, no zero cells — and
 * Record payment (a group first when there are several, then UPI · Cash ·
 * Bank). "Why" is folded: opened, each group you share says in plain lines
 * what is between you there, and when the group's plan routes money another
 * way, who pays whom directly instead of through whom.
 */
export default function PersonPage() {
  const subjectId = safeDecode(usePathParam("/people/:subjectId", "subjectId"));
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const person = usePerson(subjectId);

  return (
    <div className="space-y-4">
      {person.loading || profile.loading ? (
        <PersonSkeleton />
      ) : person.error?.code === "not_found" ? (
        <KCard className="flex flex-col items-center px-6 py-10 text-center">
          <h1 className="text-lg font-bold tracking-tight">
            {myId && subjectId === myId ? "That's you" : "You don't share a group with them"}
          </h1>
          <Button asChild className={cn(K_BUTTON, "mt-4")}>
            <Link href="/people">People</Link>
          </Button>
        </KCard>
      ) : person.error || !person.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this person.</p>
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

const TONE: Record<PersonMoneyLine["tone"], string> = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-foreground" };

function PersonView({ view, myId }: { view: PersonViewResponse; myId: string | null }) {
  const names = useMemberNames();
  const name = personName(view);
  const money = personMoney(view);
  const options = recordOptions(view, myId);
  // Money is open between you only in groups you view: nothing to record, and why in two words.
  const viewOnly = options.length === 0 && view.groups.some((g) => g.planMinor !== 0);

  return (
    <div className="space-y-4">
      <header className="flex min-h-11 items-center gap-2">
        <BackButton />
        <Face subjectId={view.subjectId} meId={myId} names={names} />
        <h1 className="min-w-0 flex-1 truncate text-[26px] font-extrabold leading-tight tracking-tight">{name}</h1>
      </header>

      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6">
        <div className="space-y-3 min-[900px]:sticky min-[900px]:top-6">
          <section aria-label="Between you two" className={cn("grid gap-3 rounded-[22px] border bg-card px-[18px] py-3", money.length > 1 && "grid-cols-2")}>
            {money.map((m) => (
              <p key={m.currency} className="min-w-0">
                <span className="block truncate text-[13px] font-bold text-muted-foreground">{m.amount ? m.label : ""}</span>
                <span className={cn("block truncate text-[28px] font-extrabold leading-tight tracking-tight tabular-nums", TONE[m.tone])}>
                  {m.amount ?? m.label}
                </span>
              </p>
            ))}
          </section>
          {options.length > 0 ? (
            <RecordPayment name={firstName(view)} fullName={name} myId={myId} options={options} />
          ) : viewOnly ? (
            <p className="px-1 text-sm font-semibold text-muted-foreground">View only</p>
          ) : null}
        </div>

        <Why view={view} myId={myId} names={names} />
      </div>
    </div>
  );
}

// ── Record payment ─────────────────────────────────────────────────

function RecordPayment({
  name,
  fullName,
  myId,
  options,
}: {
  name: string;
  fullName: string;
  myId: string | null;
  options: RecordOption[];
}) {
  const recordPayment = useRecordPayment();
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const panelId = React.useId();
  // One group: nothing to pick.
  const option = options.length === 1 ? options[0]! : (options.find((o) => o.orgId === chosen) ?? null);

  React.useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);

  // Recorded at once (SM-5), as everywhere: the panel closes on the one-line
  // Undo toast ("Dev paid you ₹90.00 · UPI") before the server answers; the
  // balances here are read again once it has, and a refusal says why.
  const record = (o: RecordOption, method: SettlementMethod) => {
    setOpen(false);
    void recordPayment({
      orgId: o.orgId,
      payment: { fromSubjectId: o.fromSubjectId, toSubjectId: o.toSubjectId, amountMinor: o.amountMinor },
      currency: o.currency,
      method,
      leftText: `${fullName} has left ${o.groupName}.`,
    });
  };

  return (
    <div>
      {!open ? (
        <Button className={MAIN_BUTTON} aria-expanded={false} aria-controls={panelId} onClick={() => setOpen(true)}>
          <MainButtonLabel title="Record payment" />
        </Button>
      ) : (
        <div id={panelId} className="space-y-3 rounded-[22px] border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold tracking-tight">{options.length > 1 ? "Which group?" : "How was it paid?"}</h2>
            <button
              type="button"
              aria-label="Cancel recording"
              onClick={() => setOpen(false)}
              className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          {options.length > 1 ? (
            <div role="radiogroup" aria-label="Which group" className="space-y-2">
              {options.map((o) => (
                <button
                  key={o.orgId}
                  type="button"
                  role="radio"
                  aria-checked={chosen === o.orgId}
                  onClick={() => setChosen(o.orgId)}
                  className={cn(
                    "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    chosen === o.orgId ? "border-primary bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span className="min-w-0 truncate text-[15px] font-semibold">{o.groupName}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {recordOptionSentence(o, name, myId).replace(` in ${o.groupName}`, "")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[15px] font-semibold">{recordOptionSentence(options[0]!, name, myId)}</p>
          )}
          {option ? (
            <div role="group" aria-label="How was it paid?" className="flex flex-wrap gap-2">
              {SETTLE_METHODS.map((m) => (
                <Chip key={m.id} onClick={() => record(option, m.id)}>
                  {m.label}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Why (folded) ───────────────────────────────────────────────────

function Why({ view, myId, names }: { view: PersonViewResponse; myId: string | null; names: MemberNames }) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const name = firstName(view);
  return (
    <section className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[22px] border bg-card px-4 text-left text-base font-extrabold tracking-tight transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Why
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={panelId} hidden={!open} className="mt-3 space-y-3">
        {open ? view.groups.map((g) => <WhyGroup key={g.orgId} group={g} view={view} name={name} myId={myId} names={names} />) : null}
      </div>
    </section>
  );
}

/**
 * One group's why, in plain lines: each entry between you two with its
 * amount, what you owe each other directly, the plan's other way (when there
 * is one) and what the plan asks — the last line, in bold.
 */
function WhyGroup({
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
  const [now] = React.useState(() => new Date());
  const shortcut = shortcutPlain(group, { meId: myId, otherId: view.subjectId, otherName: name, names });
  const tone = (minor: number) => (minor > 0 ? "text-cp-owed" : minor < 0 ? "text-cp-owe" : "text-muted-foreground");
  return (
    <KCard className="p-4">
      <h3 className="truncate text-base font-extrabold tracking-tight">
        <Link href={`/groups/${group.slug}`} className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {group.name}
        </Link>
      </h3>
      {group.lines.length > 0 ? (
        <ul className="mt-1 divide-y">
          {group.lines.map((l) => (
            <li key={`${l.txnId}:${l.signedMinor}`} className="flex min-h-11 items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[15px] font-semibold", l.reversed && "text-muted-foreground line-through")}>{l.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {l.reversed ? "Undone · " : ""}
                  {relativeWhen(l.occurredAt, now)}
                </span>
              </span>
              <span className={cn("shrink-0 text-[15px] font-bold tabular-nums", l.reversed ? "text-muted-foreground line-through" : tone(l.signedMinor))}>
                <span aria-hidden>{formatSignedMinor(l.signedMinor, group.currency)}</span>
                <span className="sr-only">
                  {l.signedMinor > 0 ? `${name} owes you` : `you owe ${name}`} {formatMinor(Math.abs(l.signedMinor), group.currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-2 space-y-1.5 border-t pt-2 text-[15px]">
        <li className="text-muted-foreground">{betweenSentence(name, group)}</li>
        {shortcut ? <li className="text-muted-foreground">{shortcut}</li> : null}
        <li className={cn("font-extrabold", tone(group.planMinor))}>{planSentence(name, group)}</li>
      </ul>
    </KCard>
  );
}

function PersonSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-11 w-48" />
      <Skeleton className="h-[84px] w-full rounded-[22px]" />
      <Skeleton className="h-[60px] w-full rounded-[18px]" />
      <Skeleton className="h-12 w-full rounded-[22px]" />
    </div>
  );
}
