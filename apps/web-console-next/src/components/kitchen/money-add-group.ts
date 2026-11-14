/**
 * Add group from Money (money-native MY-9), as pure logic: the form's
 * choices and the creation itself (organization, then kitchen settings),
 * with the calls passed in. Same rules as the New group dialog: the name
 * checks, `GROUP_CURRENCIES`, `WASTE_RULES`. A group has exactly one currency.
 */

import type { PublicOrganization } from "@saas/contracts/membership";
import {
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  type KitchenSettings,
  type WastePolicy,
} from "@saas/contracts/kitchen";
import type { ApiResult } from "@/lib/api";
import { GROUP_CURRENCIES, WASTE_RULES, groupSlug, validateGroupName } from "./groups";

export interface AddGroupForm {
  name: string;
  currency: string;
  waste: WastePolicy;
}

export const EMPTY_ADD_GROUP: AddGroupForm = {
  name: "",
  currency: DEFAULT_KITCHEN_CURRENCY,
  waste: DEFAULT_WASTE_POLICY,
};

/** A currency on the list, else the default: the group never ends up with an unknown one. */
export function currencyChoice(code: string): string {
  return GROUP_CURRENCIES.some((c) => c.code === code) ? code : DEFAULT_KITCHEN_CURRENCY;
}

export function currencyLabel(code: string): string {
  return GROUP_CURRENCIES.find((c) => c.code === code)?.label ?? code;
}

export function wasteChoice(id: string): WastePolicy {
  return WASTE_RULES.find((r) => r.id === id)?.id ?? DEFAULT_WASTE_POLICY;
}

export const GROUPS_PER_PERSON_MESSAGE =
  "You're in as many groups as you can be. Leave one you no longer use to start another.";

export const RULES_NOT_SAVED = "The currency and food rule weren't saved. Set them in the group's settings.";

export interface AddGroupApi {
  createOrganization(body: { name: string; slug: string }): Promise<ApiResult<{ organization: PublicOrganization }>>;
  saveSettings(orgId: string, body: { currency: string; wastePolicy: WastePolicy }): Promise<ApiResult<KitchenSettings>>;
}

export type AddGroupOutcome =
  | { ok: true; org: PublicOrganization; settings: KitchenSettings | null; settingsError: string | null }
  | { ok: false; message: string; nameError?: string };

/**
 * Create the group, then save its currency and food rule. If the group is
 * made but the rules are not saved, that is still `ok` (the group exists)
 * with `settingsError` for the person to be told.
 */
export async function createGroup(api: AddGroupApi, form: AddGroupForm, suffix: string): Promise<AddGroupOutcome> {
  const nameError = validateGroupName(form.name);
  if (nameError) return { ok: false, message: nameError, nameError };
  const name = form.name.trim();
  const created = await api.createOrganization({ name, slug: groupSlug(name, suffix) });
  if (!created.ok) {
    return {
      ok: false,
      message: created.error.reason === "groups_per_person" ? GROUPS_PER_PERSON_MESSAGE : created.error.message,
    };
  }
  const org = created.data.organization;
  const saved = await api.saveSettings(org.id, { currency: currencyChoice(form.currency), wastePolicy: wasteChoice(form.waste) });
  return saved.ok
    ? { ok: true, org, settings: saved.data, settingsError: null }
    : { ok: true, org, settings: null, settingsError: RULES_NOT_SAVED };
}
