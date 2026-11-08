"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicOrganization } from "@saas/contracts/membership";
import { DEFAULT_KITCHEN_CURRENCY, DEFAULT_WASTE_POLICY, type WastePolicy } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { recordRecentGroup } from "@/lib/recent-groups";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GROUP_CURRENCIES, GROUP_NAME_MAX, WASTE_RULES, groupSlug, validateGroupName } from "./groups";
import { CLOSE_44, K_BUTTON, K_INPUT } from "./kit";
import { useKitchenRouter } from "./transition-ui";

/** Six random base-36 characters for a new group's slug. */
function slugSuffix(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/**
 * New group (CP-5): a name, the group's currency (INR by default) and its
 * waste rule. Creates the organization, then saves its kitchen settings, then
 * opens the group. If the settings save fails the group still exists: the
 * person is told, and can set the rules on the group page.
 */
export function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useKitchenRouter();
  const qc = useQueryClient();
  const { client } = useSession();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState(DEFAULT_KITCHEN_CURRENCY);
  const [waste, setWaste] = React.useState<WastePolicy>(DEFAULT_WASTE_POLICY);
  const [showErrors, setShowErrors] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const reset = () => {
    setName("");
    setCurrency(DEFAULT_KITCHEN_CURRENCY);
    setWaste(DEFAULT_WASTE_POLICY);
    setShowErrors(false);
    setServerError(null);
  };

  const nameError = validateGroupName(name);

  const close = () => {
    if (busy) return;
    reset();
    onOpenChange(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    setServerError(null);
    if (nameError) return;
    const trimmed = name.trim();
    setBusy(true);

    const created = await wrap(() =>
      client.organizations.create(
        { name: trimmed, slug: groupSlug(trimmed, slugSuffix()) },
        { idempotencyKey: crypto.randomUUID() },
      ),
    );
    if (!created.ok) {
      setBusy(false);
      setServerError(
        created.error.reason === "groups_per_person"
          ? "You're in as many groups as you can be. Leave one you no longer use to start another."
          : created.error.message,
      );
      return;
    }
    const org = created.data.organization;

    // Show the new group at once (the group page resolves its slug from this
    // list), then refetch the real list in the background.
    qc.setQueryData<PublicOrganization[]>(qk.orgs(), (old) => (old ? [...old, org] : [org]));
    void qc.invalidateQueries({ queryKey: qk.orgs() });

    const settings = await wrap(() =>
      client.kitchen.updateSettings(
        org.id,
        { currency, wastePolicy: waste },
        { idempotencyKey: crypto.randomUUID() },
      ),
    );
    if (settings.ok) {
      qc.setQueryData(qk.kitchenSettings(org.id), settings.data);
      toast({ kind: "success", title: `${org.name} is ready`, description: "Invite people with its join link." });
    } else {
      toast({
        kind: "warning",
        title: `${org.name} created, but its rules weren't saved`,
        description: "Set the currency and waste rule on the group page.",
      });
    }

    recordRecentGroup(org.slug);
    setBusy(false);
    reset();
    onOpenChange(false);
    router.push(`/groups/${org.slug}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[22px] sm:max-w-md", CLOSE_44)}>
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold">New group</DialogTitle>
          <DialogDescription>For a flat, a lunch club, or anyone you cook and shop with.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-group-name">Name</Label>
            <Input
              id="new-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Flat 4B"
              maxLength={GROUP_NAME_MAX}
              autoComplete="off"
              aria-invalid={showErrors && !!nameError}
              aria-describedby={showErrors && nameError ? "new-group-name-error" : undefined}
              className={K_INPUT}
            />
            {showErrors && nameError ? (
              <p id="new-group-name-error" className="text-sm font-medium text-destructive">
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-group-currency">Currency</Label>
            <select
              id="new-group-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-describedby="new-group-currency-hint"
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[15px]"
            >
              {GROUP_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <p id="new-group-currency-hint" className="text-xs text-muted-foreground">
              Every amount in the group uses it. It can&apos;t be changed later.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">When food goes to waste</legend>
            {WASTE_RULES.map((rule) => (
              <label
                key={rule.id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                  waste === rule.id ? "border-primary bg-accent" : "hover:bg-accent/60",
                )}
              >
                <input
                  type="radio"
                  name="new-group-waste"
                  value={rule.id}
                  checked={waste === rule.id}
                  onChange={() => setWaste(rule.id)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                />
                <span>
                  <span className="block text-[15px] font-semibold">{rule.label}</span>
                  <span className="block text-xs text-muted-foreground">{rule.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {serverError ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {serverError}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className={K_BUTTON} disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" className={K_BUTTON} loading={busy}>
              Create group
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
