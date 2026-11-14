"use client";

import * as React from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { SplitecoBalancesResponse, SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { GroupsPage, MoneyHeader } from "@saas/spliteco-ui/groups-ui";
import { PeopleScreen, PersonScreen } from "@saas/spliteco-ui/people-ui";
import { SettleBox, SettleUpBox } from "@saas/spliteco-ui/settle-box-ui";
import { ExpenseButton } from "@saas/spliteco-ui/expense-ui";
import { settleCurrencies } from "@saas/spliteco-ui/settle-box";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { useBack } from "./back-ui";
import { useKitchenRouter } from "./transition-ui";
import {
  MONEY_ADD_GROUP_HREF,
  createExpenseFor,
  expenseGroupsFrom,
  idempotencyKeys,
  moneyGroupHref,
  moneyHref,
  legacyMoneyHref,
  settleApiFor,
} from "./money-native";

/** Opens the person's own UPI app (a `upi://pay` link); Paid then records the payment. */
const openUpi = (url: string): void => {
  window.location.assign(url);
};

/** What every Money page reads and writes through: the client, the signed-in person, the shared pages' APIs. */
function useMoney() {
  const { client } = useSession();
  const qc = useQueryClient();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const [version, setVersion] = React.useState(0);
  const keys = React.useMemo(() => idempotencyKeys(), []);
  const settleApi = React.useMemo(() => settleApiFor(client, keys), [client, keys]);
  const createExpense = React.useMemo(() => createExpenseFor(client, keys), [client, keys]);
  // A new object makes the shared pages read the balances again (after a payment landed).
  const peopleApi = React.useMemo(() => ({ balances: () => client.spliteco.balances() }), [client, version]);
  const refresh = React.useCallback(() => {
    setVersion((v) => v + 1);
    void qc.invalidateQueries({ queryKey: ["money"] });
  }, [qc]);
  return { client, meId, settleApi, createExpense, peopleApi, refresh };
}

/**
 * Money, native (money-native MY-8): the shared pages of `@saas/spliteco-ui`
 * in Cookpool's own look (theme `cookpool`, whose tokens globals.css maps onto
 * Cookpool's light and dark palettes) under Cookpool's own tab bar. Groups and
 * People, a person's page, the settle box and the expense box all read and
 * write through this app's client; nothing here opens the Spliteco app.
 *
 * Every step is a route (MY-21), taken through the frame's router so it gets
 * its transition and its place in the back trail: `/money` (Groups),
 * `/money/people`, `/money/people/<subject id>`; Back (the arrow, the system's,
 * the edge swipe) goes back through them. The first build's `?side=` and
 * `?person=` addresses are sent to their routes.
 */
export function MoneyNative() {
  const router = useKitchenRouter();
  const params = useSearchParams();
  const legacy = legacyMoneyHref(params);
  React.useEffect(() => {
    if (legacy) router.replace(legacy);
  }, [legacy, router]);
  const { client, meId, createExpense, refresh } = useMoney();
  const { toast } = useToast();

  const groups = useQuery({ queryKey: qk.moneyGroups(), queryFn: async () => (await client.spliteco.groups()).groups });
  const details = useQueries({
    queries: (groups.data ?? []).map((g) => ({ queryKey: qk.moneyGroup(g.id), queryFn: () => client.spliteco.group(g.id) })),
  });
  const expenseGroups = expenseGroupsFrom(details.map((d) => d.data));

  if (legacy) return <Skeleton className="h-8 w-32" aria-hidden />;

  if (groups.isError) {
    return (
      <div data-money="error" className="p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups.</p>
        <button type="button" className="mt-3 h-11 rounded-[10px] bg-accent px-4 text-sm font-medium text-accent-foreground" onClick={() => void groups.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <GroupsPage
      theme="cookpool"
      groups={groups.data ?? []}
      onSide={(side) => router.push(moneyHref({ kind: side }))}
      onOpenGroup={(id) => router.push(moneyGroupHref(id))}
      onAddGroup={() => router.push(MONEY_ADD_GROUP_HREF)}
      floatingButton={
        meId && expenseGroups.length > 0 ? (
          <ExpenseButton
            theme="cookpool"
            groups={expenseGroups}
            me={meId}
            createExpense={createExpense}
            onSaved={() => {
              toast({ kind: "success", title: "Expense added" });
              refresh();
            }}
          />
        ) : null
      }
    />
  );
}

/** Money's People side, `/money/people`: everyone you split with, Pay or Got it, and the settle box. */
export function MoneyPeople() {
  const router = useKitchenRouter();
  const { meId, settleApi, peopleApi, refresh } = useMoney();
  const open = (p: { subjectId: string }) => router.push(moneyHref({ kind: "person", subjectId: p.subjectId }));
  return (
    <PeopleScreen
      theme="cookpool"
      api={peopleApi}
      header={<MoneyHeader side="people" onSide={(side) => router.push(moneyHref({ kind: side }))} />}
      onOpenPerson={(id) => open({ subjectId: id })}
      onPay={open}
      onGotIt={open}
      floatingButton={<PeopleSettleUp api={peopleApi} settleApi={settleApi} meId={meId} onRecorded={refresh} />}
    />
  );
}

/** People's "Settle up" (kind `people`): the simplified payments, each Paid or Got it. */
function PeopleSettleUp({ api, settleApi, meId, onRecorded }: { api: { balances(): Promise<SplitecoBalancesResponse> }; settleApi: ReturnType<typeof settleApiFor>; meId: string | null; onRecorded: () => void }) {
  const [people, setPeople] = React.useState<SplitecoPersonBalance[]>([]);
  React.useEffect(() => {
    let live = true;
    api.balances().then(
      (r) => live && setPeople(r.people),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);
  if (!meId || people.every((p) => p.settled)) return null;
  return <SettleUpBox theme="cookpool" people={people} meId={meId} api={settleApi} onRecorded={onRecorded} />;
}

/** A person's page, `/money/people/<subject id>`, with its settle box: you pay them when you owe, "Got it" when they owe you. */
export function MoneyPerson({ subjectId }: { subjectId: string }) {
  const goBack = useBack();
  const { meId, settleApi, peopleApi: api, refresh } = useMoney();
  const [person, setPerson] = React.useState<SplitecoPersonBalance | null>(null);
  React.useEffect(() => {
    let live = true;
    api.balances().then(
      (r) => live && setPerson(r.people.find((p) => p.subjectId === subjectId) ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, subjectId]);
  const owes = person ? person.balances.some((b) => b.amountMinor < 0) : false;
  const direction = owes ? "pay" : "got";
  return (
    <PersonScreen
      theme="cookpool"
      api={api}
      subjectId={subjectId}
      onBack={goBack}
      floatingButton={
        person && meId && settleCurrencies(person, direction).length > 0 ? (
          <SettleBox theme="cookpool" person={person} meId={meId} direction={direction} api={settleApi} openUpi={openUpi} onRecorded={refresh} />
        ) : null
      }
    />
  );
}
