"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { balanceView } from "@saas/spliteco-ui/balance";
import { SettleUp } from "@saas/spliteco-ui/components";
import { SplitecoUiProvider } from "@saas/spliteco-ui/theme";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "./data";
import { BackControl } from "./back-ui";
import { KCard, K_BUTTON_QUIET } from "./kit";
import { moneyGroupHref, safeSettleBack } from "./money-page";
import { refreshLedger } from "./ledger-data";
import { payKitchen, useKitchenGroup } from "./kitchen-money-data";
import { COOKPOOL_SPLITECO_THEME } from "./spliteco-theme";
import { useKitchenRouter } from "./transition-ui";

/**
 * Settle up with one person in one kitchen (cookpool-spliteco SE3): what you
 * owe them on the Kitchen balance (spliteco-worker's Kitchen-only read), paid
 * the shared way — UPI opens your UPI app with a `upi://pay` link and records
 * nothing until "I paid"; cash and bank record in one tap — and recorded with
 * `bucket: "kitchen"`, so it pays Kitchen only and never more than it. It
 * shows in Spliteco at once: both apps write the one ledger.
 *
 * The one settle path in Cookpool's new frame (RV-17): Money's Settle up, a
 * person's and a group's all lead here.
 */
export function KitchenSettleScreen() {
  const params = useSearchParams();
  const orgId = params?.get("group") ?? null;
  const to = params?.get("to") ?? null;
  const router = useKitchenRouter();
  // Back and Done return where Settle up was opened (Money, a person or a group; `safeSettleBack`), else this kitchen on Money.
  const backTo = safeSettleBack(params?.get("back")) ?? (orgId ? moneyGroupHref(orgId) : "/money");
  const back = React.useCallback(() => router.replace(backTo), [router, backTo]);

  return (
    <div className="space-y-[18px] pb-28 min-[900px]:max-w-xl">
      <header className="flex min-h-11 items-center gap-2">
        <BackControl onClick={back} />
        <h1 className="text-[17px] font-medium">Settle up</h1>
      </header>
      {orgId && to ? <Pay orgId={orgId} to={to} onDone={back} /> : <Nothing onBack={back} />}
    </div>
  );
}

function Nothing({ onBack, text = "Nothing to settle here." }: { onBack: () => void; text?: string }) {
  return (
    <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button variant="ghost" className={K_BUTTON_QUIET} onClick={onBack}>
        Back to Money
      </Button>
    </KCard>
  );
}

function Pay({ orgId, to, onDone }: { orgId: string; to: string; onDone: () => void }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const profile = useProfile();
  const read = useKitchenGroup(orgId);
  const key = React.useRef<string>(crypto.randomUUID());
  const me = profile.data?.id ?? null;
  if (read.loading || !me) return <Skeleton className="h-80 w-full rounded-[22px]" aria-hidden />;
  if (read.error || !read.data) return <Nothing onBack={onDone} text="Couldn't load this kitchen's money." />;
  const data = read.data;
  const names = new Map([...data.members, ...data.people].map((p) => [p.subjectId, p.name] as const));
  const view = balanceView(data, me, names);
  const row = view.rows.find((r) => r.subjectId === to && r.amountMinor < 0);
  if (!row) return <Nothing onBack={onDone} text={`You don't owe ${names.get(to) ?? "them"} anything in this kitchen right now.`} />;
  return (
    <SplitecoUiProvider theme={COOKPOOL_SPLITECO_THEME}>
      <SettleUp
        payee={{ subjectId: to, name: row.name, upiVpa: data.upi.find((u) => u.subjectId === to)?.upiVpa ?? null }}
        groupName={view.groupName}
        amountMinor={-row.amountMinor}
        currency={view.currency}
        onRecord={(method, note) => payKitchen(client, orgId, { toSubjectId: to, amountMinor: -row.amountMinor, method, note }, key.current)}
        // Refreshed on the way out, so "Recorded" stays on screen until Done.
        onDone={() => {
          refreshLedger(qc, orgId);
          onDone();
        }}
      />
    </SplitecoUiProvider>
  );
}
