"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { recordRecentGroup } from "@/lib/recent-groups";
import { useToast } from "@/components/ui/toast";
import { GROUP_CURRENCIES, GROUP_NAME_MAX, WASTE_RULES, validateGroupName } from "./groups";
import { look } from "@saas/spliteco-ui/look";
import { FOCUS, HIT_44, SHEET, BoardSheet, Card, PrimaryAction, RadioRow, Section, SheetTitleRow, chevronDown, fieldStyle, smallButtonStyle } from "./money-sheet-kit";
import { useProfile } from "./data";
import { EMPTY_ADD_GROUP, createGroup, currencyChoice, currencyLabel, peopleNote, wasteChoice, type AddGroupForm } from "./money-add-group";
import { createGroupPlan, currencyChoices, type StartFromSpliteco } from "./money-start-from-spliteco";
import {
  SplitecoGroupPicker,
  StartFromSplitecoRow,
  recordAddedFromSpliteco,
  usePickSplitecoGroup,
  useSplitecoGroupsForPicker,
} from "./money-start-from-spliteco-ui";

function slugSuffix(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

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
  startFromSpliteco = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Rendered above Name: MY-10's "Start from Spliteco" row. */
  startFromSlot?: React.ReactNode;
  /** Pre-filled choices (MY-10 fills the name and currency from a Spliteco group). */
  initial?: Partial<AddGroupForm>;
  /** MY-10: show the Start from Spliteco row above Name (in the slot). */
  startFromSpliteco?: boolean;
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
  const profile = useProfile();
  const [from, setFrom] = React.useState<StartFromSpliteco | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pickError, setPickError] = React.useState<string | null>(null);
  const [pickBusy, setPickBusy] = React.useState(false);
  const picker = useSplitecoGroupsForPicker(startFromSpliteco && picking);
  const pickGroup = usePickSplitecoGroup(profile.data?.id ?? null);
  const currencies = currencyChoices(GROUP_CURRENCIES, from?.currencies ?? []);
  const extraCurrencies = from?.currencies ?? [];

  const onPick = async (group: Parameters<typeof pickGroup>[0]) => {
    setPickError(null);
    setPickBusy(true);
    try {
      const picked = await pickGroup(group);
      setFrom(picked);
      // The name fills but stays editable; changing it never touches the Spliteco group.
      setForm((f) => ({ ...f, name: picked.name, currency: picked.currency }));
      setPicking(false);
    } catch {
      setPickError("Couldn't open that group. Try again.");
    } finally {
      setPickBusy(false);
    }
  };

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
        addMembers: (orgId, body) => wrap(() => client.memberships.addMembers(orgId, body, { idempotencyKey: crypto.randomUUID() })),
        saveSettings: (orgId, body) => wrap(() => client.kitchen.updateSettings(orgId, body, { idempotencyKey: crypto.randomUUID() })),
      },
      form,
      slugSuffix(),
      {
        extraCurrencies,
        bring: from
          ? { sourceGroupId: from.fromGroupId, subjectIds: createGroupPlan({ name: form.name, currency: form.currency, wastePolicy: form.waste, from }).bringSubjectIds }
          : null,
      },
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
    if (from) recordAddedFromSpliteco(from.fromGroupId);
    const note = peopleNote(out.people, new Map(from?.people.map((p) => [p.subjectId, p.name]) ?? []));
    if (note) toast({ kind: "warning", title: note });
    recordRecentGroup(org.slug);
    setBusy(false);
    router.replace(`/groups/${org.slug}`);
  };

  return (
    <BoardSheet open={open} onOpenChange={(o) => (o ? undefined : close())} label={picking ? "Spliteco groups" : "Add group"}>
      {picking ? (
        <>
          {pickError ? <p role="alert" style={{ margin: 0, fontSize: 14, fontWeight: 500, color: look.owe }}>{pickError}</p> : null}
          <SplitecoGroupPicker
            groups={picker.groups}
            recent={picker.recent}
            addedIds={picker.addedIds}
            loading={picker.loading || pickBusy}
            error={picker.error}
            onRetry={() => void picker.refetch()}
            onPick={(g) => void onPick(g)}
            onClose={() => setPicking(false)}
          />
        </>
      ) : (
        <>
          <SheetTitleRow title="Add group" />
          <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: SHEET.gap, minHeight: 0, flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: SHEET.gap, overflowY: "auto", minHeight: 0, flex: 1, margin: "0 -20px", padding: "0 20px" }}>
              {startFromSlot || startFromSpliteco ? (
                <div data-slot="start-from">
                  {startFromSlot}
                  {startFromSpliteco ? (
                    <StartFromSplitecoRow picked={from ? { name: from.name, people: from.people.length } : null} onOpen={() => setPicking(true)} />
                  ) : null}
                </div>
              ) : null}

              <Section label="Name" labelId="add-group-name-label">
                <input
                  id="add-group-name"
                  aria-labelledby="add-group-name-label"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Flat 4B"
                  maxLength={GROUP_NAME_MAX}
                  autoComplete="off"
                  aria-invalid={showErrors && !!nameError}
                  aria-describedby={showErrors && nameError ? "add-group-name-error" : undefined}
                  className={cn(FOCUS, "placeholder:text-[color:var(--look-muted)]")}
                  style={{ ...fieldStyle, outline: "none" }}
                />
                {showErrors && nameError ? (
                  <p id="add-group-name-error" style={{ margin: 0, padding: "0 2px", fontSize: 13, fontWeight: 500, color: look.owe }}>{nameError}</p>
                ) : null}
              </Section>

              <Section label="Currency">
                <label className="has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring" style={{ position: "relative", display: "flex", alignItems: "center", height: SHEET.field, padding: "0 16px", borderRadius: SHEET.fieldRadius, background: look.surface, fontSize: 15, fontWeight: 500, cursor: "pointer", boxSizing: "border-box" }}>
                  <span style={{ flex: 1 }}>{currencies.find((c) => c.code === form.currency)?.label ?? currencyLabel(form.currency)}</span>
                  {chevronDown}
                  <select
                    aria-label="Currency"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: currencyChoice(e.target.value, extraCurrencies) })}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 16 }}
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </label>
              </Section>

              <fieldset style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
                <Section label="When food goes to waste">
                  <Card role="radiogroup" aria-label="When food goes to waste">
                    {WASTE_RULES.map((rule, i) => (
                      <RadioRow
                        key={rule.id}
                        name="add-group-waste"
                        value={rule.id}
                        label={rule.label}
                        hint={rule.hint}
                        first={i === 0}
                        checked={form.waste === rule.id}
                        onSelect={() => setForm({ ...form, waste: wasteChoice(rule.id) })}
                      />
                    ))}
                  </Card>
                </Section>
              </fieldset>

              <Section label="People">
                <Card>
                  {from ? (
                    <div data-people-note="" style={{ display: "flex", alignItems: "center", height: SHEET.actionRow, padding: "0 16px", fontSize: 15, fontWeight: 500 }}>
                      {from.people.length === 1 ? "1 person comes along" : `${from.people.length} people come along`}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, height: SHEET.actionRow, padding: "0 12px 0 16px" }}>
                      <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Share join link</span>
                      {/* The link exists once the group does: it is Copy on Manage group. */}
                      <button type="button" disabled data-action="copy-join-link" className={HIT_44} style={{ ...smallButtonStyle, opacity: 0.5, cursor: "default" }}>
                        Copy
                      </button>
                    </div>
                  )}
                </Card>
              </Section>

              {serverError ? (
                <p role="alert" style={{ margin: 0, fontSize: 14, fontWeight: 500, color: look.owe }}>{serverError}</p>
              ) : null}
            </div>

            <PrimaryAction type="submit" busy={busy}>
              {from ? "Add to Cookpool" : "Create group"}
            </PrimaryAction>
          </form>
        </>
      )}
    </BoardSheet>
  );
}

/** The Add group route: the sheet over Money; closing goes back to Money. */
export function MoneyAddGroup() {
  const router = useRouter();
  return <AddGroupSheet open startFromSpliteco onClose={() => router.replace("/money")} />;
}
