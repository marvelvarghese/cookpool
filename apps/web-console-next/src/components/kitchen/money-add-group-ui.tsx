"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Link2 } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { recordRecentGroup } from "@/lib/recent-groups";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GROUP_CURRENCIES, GROUP_NAME_MAX, WASTE_RULES, validateGroupName } from "./groups";
import { CLOSE_44, K_INPUT } from "./kit";
import { EMPTY_ADD_GROUP, createGroup, currencyChoice, currencyLabel, wasteChoice, type AddGroupForm } from "./money-add-group";

function slugSuffix(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

const ROW = "flex min-h-[52px] items-center gap-3 px-3.5 py-2";
const CARD = "divide-y divide-cp-line overflow-hidden rounded-xl bg-card shadow-cp-card";
const LABEL = "mb-1.5 block text-[13px] font-medium text-muted-foreground";

/**
 * Add group from Money (MY-9): a sheet with Name, Currency, When food goes
 * to waste, People and Create group. `startFromSlot` is where MY-10's
 * "Start from Spliteco" row goes: it renders above Name, nothing else moves.
 */
export function AddGroupSheet({
  open,
  onClose,
  startFromSlot,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /** Rendered above Name: MY-10's "Start from Spliteco" row. */
  startFromSlot?: React.ReactNode;
  /** Pre-filled choices (MY-10 fills the name and currency from a Spliteco group). */
  initial?: Partial<AddGroupForm>;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { client } = useSession();
  const { toast } = useToast();
  const [form, setForm] = React.useState<AddGroupForm>({ ...EMPTY_ADD_GROUP, ...initial });
  const [showErrors, setShowErrors] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const nameError = validateGroupName(form.name);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    setServerError(null);
    if (nameError) return;
    setBusy(true);
    const out = await createGroup(
      {
        createOrganization: (body) => wrap(() => client.organizations.create(body, { idempotencyKey: crypto.randomUUID() })),
        saveSettings: (orgId, body) => wrap(() => client.kitchen.updateSettings(orgId, body, { idempotencyKey: crypto.randomUUID() })),
      },
      form,
      slugSuffix(),
    );
    if (!out.ok) {
      setBusy(false);
      setServerError(out.message);
      return;
    }
    const { org } = out;
    qc.setQueryData<PublicOrganization[]>(qk.orgs(), (old) => (old ? [...old, org] : [org]));
    void qc.invalidateQueries({ queryKey: qk.orgs() });
    void qc.invalidateQueries({ queryKey: ["money"] });
    if (out.settings) {
      qc.setQueryData(qk.kitchenSettings(org.id), out.settings);
      toast({ kind: "success", title: `${org.name} is ready` });
    } else {
      toast({ kind: "warning", title: `${org.name} created, but its rules weren't saved`, description: out.settingsError ?? undefined });
    }
    recordRecentGroup(org.slug);
    setBusy(false);
    router.replace(`/groups/${org.slug}`);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn("mx-auto flex max-h-[94dvh] max-w-xl flex-col gap-3 rounded-t-[22px] border-x-0 bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 min-[900px]:bottom-6 min-[900px]:rounded-[22px] min-[900px]:border", CLOSE_44)}
      >
        <div aria-hidden className="mx-auto h-[5px] w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="pr-12 text-[22px] font-medium tracking-[-0.02em]">Add group</SheetTitle>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-1">
            {startFromSlot ? <div data-slot="start-from">{startFromSlot}</div> : null}

            <div>
              <label htmlFor="add-group-name" className={LABEL}>Name</label>
              <Input
                id="add-group-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Flat 4B"
                maxLength={GROUP_NAME_MAX}
                autoComplete="off"
                aria-invalid={showErrors && !!nameError}
                aria-describedby={showErrors && nameError ? "add-group-name-error" : undefined}
                className={cn(K_INPUT, "rounded-[10px]")}
              />
              {showErrors && nameError ? (
                <p id="add-group-name-error" className="mt-1.5 text-sm font-medium text-destructive">{nameError}</p>
              ) : null}
            </div>

            <div>
              <span className={LABEL}>Currency</span>
              <div className={CARD}>
                <label className={cn(ROW, "relative cursor-pointer")}>
                  <span className="flex-1 text-[15px] font-medium">{currencyLabel(form.currency)}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <select
                    aria-label="Currency"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: currencyChoice(e.target.value) })}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {GROUP_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <fieldset>
              <legend className={LABEL}>When food goes to waste</legend>
              <div className={CARD}>
                {WASTE_RULES.map((rule) => (
                  <label key={rule.id} className={cn(ROW, "cursor-pointer", form.waste === rule.id ? "bg-cp-accent-tint" : "hover:bg-accent/60")}>
                    <input
                      type="radio"
                      name="add-group-waste"
                      value={rule.id}
                      checked={form.waste === rule.id}
                      onChange={() => setForm({ ...form, waste: wasteChoice(rule.id) })}
                      className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                    />
                    <span>
                      <span className="block text-[15px] font-medium">{rule.label}</span>
                      <span className="block text-[13px] font-normal text-muted-foreground">{rule.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <span className={LABEL}>People</span>
              <div className={CARD}>
                <div className={ROW}>
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 text-[15px] font-medium">Share join link</span>
                  <Button type="button" variant="ghost" size="sm" disabled data-action="copy-join-link" className="rounded-[10px] bg-cp-accent-tint text-cp-accent-text">
                    Copy
                  </Button>
                </div>
              </div>
            </div>

            {serverError ? (
              <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">{serverError}</p>
            ) : null}
          </div>

          <Button type="submit" loading={busy} className="h-12 w-full rounded-xl text-[15px] font-medium">
            Create group
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** The Add group route: the sheet over Money; closing goes back to Money. */
export function MoneyAddGroup() {
  const router = useRouter();
  return <AddGroupSheet open onClose={() => router.replace("/money")} />;
}
