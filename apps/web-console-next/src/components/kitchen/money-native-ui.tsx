"use client";

import * as React from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { SplitecoBalancesResponse, SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { GroupsPage, MoneyHeader } from "@saas/spliteco-ui/groups-ui";
import { PeopleScreen, PersonScreen } from "@saas/spliteco-ui/people-ui";
import { SettleBox, SettleUpBox } from "@saas/spliteco-ui/settle-box-ui";
import { ExpenseButton } from "@saas/spliteco-ui/expense-ui";
import { settleCurrencies } from "@saas/spliteco-ui/settle-box";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { useGroups, useProfile } from "./data";
import {
  MONEY_ADD_GROUP_HREF,
  createExpenseFor,
  expenseGroupsFrom,
  idempotencyKeys,
  moneyGroupHref,
  moneyHref,
  moneyViewFrom,
  settleApiFor,
} from "./money-native";

/** Opens the person's own UPI app (a `upi://pay` link); Paid then records the payment. */
const openUpi = (url: string): void => {
  window.location.assign(url);
};

/** Clears the floating tab bar (68px, 14px from the bottom) with a margin. */
const BAR_OFFSET = 104;

/**
 * Money, native (money-native MY-8): the shared pages of `@saas/spliteco-ui`
 * in Cookpool's own look (theme `cookpool`, whose tokens globals.css maps onto
 * Cookpool's light and dark palettes) under Cookpool's own tab bar. Groups and
 * People, a person's page, the settle box and the expense box all read and
 * write through this app's client; nothing here opens the Spliteco app.
 *
 * The address is `/money` (Groups), `/money?side=people`, and
 * `/money?person=<subject id>` for a person's page.
 */
export function MoneyNative() {
  const router = useRouter();
  const params = useSearchParams();
  const view = moneyViewFrom(params);
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const profile = useProfile();
  const orgs = useGroups();
  const meId = profile.data?.id ?? null;

  const [version, setVersion] = React.useState(0);
  const keys = React.useMemo(() => idempotencyKeys(), []);
  const settleApi = React.useMemo(() => settleApiFor(client, keys), [client, keys]);
  const createExpense = React.useMemo(() => createExpenseFor(client, keys), [client, keys]);
  // A new object makes the shared pages read the balances again (after a payment landed).
  const peopleApi = React.useMemo(() => ({ balances: () => client.spliteco.balances() }), [client, version]);

  const groups = useQuery({ queryKey: qk.moneyGroups(), queryFn: async () => (await client.spliteco.groups()).groups });
  const details = useQueries({
    queries: (groups.data ?? []).map((g) => ({ queryKey: qk.moneyGroup(g.id), queryFn: () => client.spliteco.group(g.id) })),
  });
  const expenseGroups = expenseGroupsFrom(details.map((d) => d.data));

  const refresh = React.useCallback(() => {
    setVersion((v) => v + 1);
    void qc.invalidateQueries({ queryKey: ["money"] });
  }, [qc]);

  const go = (href: string) => router.push(href);
  const onSide = (side: "groups" | "people") => router.replace(moneyHref({ kind: side }));
  const addGroup = () => go(MONEY_ADD_GROUP_HREF);

  const header = (side: "groups" | "people") => <MoneyHeader side={side} onSide={onSide} {...(side === "groups" ? { onAddGroup: addGroup } : {})} />;

  if (view.kind === "person") {
    return (
      <PersonRoute
        subjectId={view.subjectId}
        meId={meId}
        api={peopleApi}
        settleApi={settleApi}
        onBack={() => router.replace(moneyHref({ kind: "people" }))}
        onRecorded={refresh}
      />
    );
  }

  if (view.kind === "people") {
    const openPerson = (p: SplitecoPersonBalance) => go(moneyHref({ kind: "person", subjectId: p.subjectId }));
    return (
      <PeopleScreen
        theme="cookpool"
        api={peopleApi}
        header={header("people")}
        onOpenPerson={(id) => go(moneyHref({ kind: "person", subjectId: id }))}
        onPay={openPerson}
        onGotIt={openPerson}
        floatingButton={<PeopleSettleUp api={peopleApi} settleApi={settleApi} meId={meId} onRecorded={refresh} />}
      />
    );
  }

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
      onSide={onSide}
      onOpenGroup={(id) => go(moneyGroupHref(id, orgs.data))}
      onAddGroup={addGroup}
      floatingButton={
        meId && expenseGroups.length > 0 ? (
          <ExpenseButton
            theme="cookpool"
            groups={expenseGroups}
            me={meId}
            bottomOffset={BAR_OFFSET}
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
  return <SettleUpBox theme="cookpool" people={people} meId={meId} api={settleApi} bottomOffset={BAR_OFFSET} onRecorded={onRecorded} />;
}

/** A person's page with its settle box: you pay them when you owe, "Got it" when they owe you. */
function PersonRoute({ subjectId, meId, api, settleApi, onBack, onRecorded }: { subjectId: string; meId: string | null; api: { balances(): Promise<SplitecoBalancesResponse> }; settleApi: ReturnType<typeof settleApiFor>; onBack: () => void; onRecorded: () => void }) {
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
      onBack={onBack}
      floatingButton={
        person && meId && settleCurrencies(person, direction).length > 0 ? (
          <SettleBox theme="cookpool" person={person} meId={meId} direction={direction} api={settleApi} openUpi={openUpi} bottomOffset={BAR_OFFSET} onRecorded={onRecorded} />
        ) : null
      }
    />
  );
}
