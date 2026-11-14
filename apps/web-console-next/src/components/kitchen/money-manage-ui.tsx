"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { WastePolicy } from "@saas/contracts/kitchen";
import { qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { forgetRecentGroup } from "@/lib/recent-groups";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useGroups, useProfile } from "./data";
import { leaveBalance } from "./groups";
import { joinUrl } from "./join-code";
import { moneyHref } from "./money-native";
import { currencyChange, isKitchenGroup, manageGroupIdFrom, manageRights } from "./money-manage";
import { ManageGroupView } from "./money-manage-view";

/** `/money/group?id=org_…`: reads the group and settings, and wires each row to its existing call. */
export function MoneyManageGroup() {
  const router = useRouter();
  const id = manageGroupIdFrom(useSearchParams());
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const profile = useProfile();
  const orgs = useGroups();
  const meId = profile.data?.id ?? null;
  const [wasteOpen, setWasteOpen] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const [left, setLeft] = React.useState(false);

  const detail = useQuery({ queryKey: qk.moneyGroup(id ?? ""), queryFn: () => client.spliteco.group(id ?? ""), enabled: !!id });
  const group = detail.data ?? null;
  const rules = group ? manageRights(group).rules : false;
  const settings = useQuery({
    queryKey: qk.kitchenSettings(id ?? ""),
    queryFn: async () => {
      const r = await wrap(() => client.kitchen.getSettings(id ?? ""));
      if (!r.ok) throw r.error;
      return r.data;
    },
    enabled: !!id && !!group && isKitchenGroup(group.group),
  });
  const code = useQuery({
    queryKey: qk.joinCode(id ?? ""),
    queryFn: async () => (await client.memberships.getJoinCode(id ?? "")).code,
    enabled: !!id && rules,
  });

  const back = () => router.replace(moneyHref({ kind: "groups" }));
  const refresh = () => void qc.invalidateQueries({ queryKey: ["money"] });

  if (!id) return <Notice text="This group isn't here." action="Back to Money" onAction={back} />;
  if (detail.isError) return <Notice text="Couldn't load this group." action="Try again" onAction={() => void detail.refetch()} />;
  if (!group || left) return <div aria-hidden style={{ padding: 20, minHeight: 200 }} />;

  const currentCurrency = settings.data?.currency ?? group.group.currency;
  const org = orgs.data?.find((o) => o.id === id);

  const saveSettings = async (body: { wastePolicy?: WastePolicy; currency?: string }): Promise<boolean> => {
    const r = await wrap(() => client.kitchen.updateSettings(id, body, { idempotencyKey: crypto.randomUUID() }));
    if (!r.ok) {
      if (r.error.reason === "currency_locked") setWarning("Can't change the currency: it is already set for this group.");
      else toast({ kind: "error", title: "Couldn't save", description: r.error.message });
      return false;
    }
    qc.setQueryData(qk.kitchenSettings(id), r.data);
    refresh();
    toast({ kind: "success", title: "Saved" });
    return true;
  };

  const link = code.data ? joinUrl(window.location.origin, code.data) : null;

  return (
    <>
      <ManageGroupView
        detail={group}
        meId={meId}
        settings={settings.data ?? null}
        joinLink={link}
        onBack={back}
        onSimplify={async (on) => {
          const r = await wrap(() => client.spliteco.setGroupSettings(id, { simplifyDebts: on }, { idempotencyKey: crypto.randomUUID() }));
          if (!r.ok) toast({ kind: "error", title: "Couldn't save", description: r.error.message });
          else toast({ kind: "success", title: "Saved" });
          refresh();
        }}
        onCurrency={(next) => {
          const verdict = currencyChange(group, currentCurrency, next);
          if (!verdict.ok) {
            setWarning(verdict.reason);
            return;
          }
          setWarning(null);
          void saveSettings({ currency: next });
        }}
        onWaste={async (rule) => {
          if (await saveSettings({ wastePolicy: rule })) setWasteOpen(false);
        }}
        onCopyLink={() => {
          if (!link) return;
          void navigator.clipboard?.writeText(link);
          toast({ kind: "success", title: "Link copied" });
        }}
        onLeave={() => setLeaving(true)}
        currencyWarning={warning}
        wasteOpen={wasteOpen}
        onWasteOpen={setWasteOpen}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave ${group.group.name}?`}
        description="To come back you'll need its join link."
        confirmLabel="Leave group"
        onConfirm={async () => {
          const r = await wrap(() => client.memberships.leave(id, { idempotencyKey: crypto.randomUUID() }));
          if (!r.ok) {
            if (r.error.reason === "last_owner") toast({ kind: "error", title: "You're the last owner", description: "Make someone else an owner first." });
            else if (r.error.reason === "balance_not_settled") toast({ kind: "error", title: leaveBalance({ name: group.group.name, slug: org?.slug ?? "" }, r.error.details).title });
            else toast({ kind: "error", title: "Couldn't leave the group", description: r.error.message });
            return;
          }
          setLeft(true);
          if (org) forgetRecentGroup(org.slug);
          toast({ kind: "success", title: `You left ${group.group.name}` });
          void qc.invalidateQueries({ queryKey: qk.orgs() });
          refresh();
          back();
        }}
      />
    </>
  );
}

function Notice({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div data-money="error" className="p-5">
      <p className="text-sm text-muted-foreground">{text}</p>
      <button type="button" className="mt-3 h-11 rounded-[10px] bg-accent px-4 text-sm font-medium text-accent-foreground" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
