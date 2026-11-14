/**
 * Add group from Money (money-native MY-9), as pure logic: the form's
 * choices and the creation itself (organization, then kitchen settings),
 * with the calls passed in. Same rules as the New group dialog: the name
 * checks, `GROUP_CURRENCIES`, `WASTE_RULES`. A group has exactly one currency.
 */

import type { AddMemberSkipReason, AddMembersRequest, AddMembersResponse, PublicOrganization } from "@saas/contracts/membership";
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
export function currencyChoice(code: string, extra: readonly string[] = []): string {
  return GROUP_CURRENCIES.some((c) => c.code === code) || extra.includes(code) ? code : DEFAULT_KITCHEN_CURRENCY;
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
  /** Start from Spliteco only: brings the people of the source group across. */
  addMembers?(orgId: string, body: AddMembersRequest): Promise<ApiResult<AddMembersResponse>>;
  saveSettings(orgId: string, body: { currency: string; wastePolicy: WastePolicy }): Promise<ApiResult<KitchenSettings>>;
}

/** What happened to the people of a Spliteco group: who came, who was skipped and why, or that the call failed. */
export interface PeopleOutcome {
  added: number;
  skipped: { subjectId: string; reason: AddMemberSkipReason }[];
  failed: boolean;
}

export type AddGroupOutcome =
  | { ok: true; org: PublicOrganization; settings: KitchenSettings | null; settingsError: string | null; people: PeopleOutcome | null }
  | { ok: false; message: string; nameError?: string };

/**
 * Create the group, then save its currency and food rule. If the group is
 * made but the rules are not saved, that is still `ok` (the group exists)
 * with `settingsError` for the person to be told.
 */
export async function createGroup(
  api: AddGroupApi,
  form: AddGroupForm,
  suffix: string,
  opts: { extraCurrencies?: readonly string[]; bring?: AddMembersRequest | null } = {},
): Promise<AddGroupOutcome> {
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
  const saved = await api.saveSettings(org.id, { currency: currencyChoice(form.currency, opts.extraCurrencies), wastePolicy: wasteChoice(form.waste) });
  let people: PeopleOutcome | null = null;
  if (opts.bring && opts.bring.subjectIds.length > 0 && api.addMembers) {
    const r = await api.addMembers(org.id, opts.bring);
    people = r.ok ? { added: r.data.added.length, skipped: r.data.skipped, failed: false } : { added: 0, skipped: [], failed: true };
  }
  return saved.ok
    ? { ok: true, org, settings: saved.data, settingsError: null, people }
    : { ok: true, org, settings: null, settingsError: RULES_NOT_SAVED, people };
}

const SKIP_WORDS: Record<AddMemberSkipReason, string> = {
  not_in_source_group: "isn't in that Spliteco group any more",
  already_member: "is already in",
  groups_per_person: "is in as many groups as they can be",
  group_full: "couldn't fit",
};

/** One plain sentence about the people who did not come, or null when everyone did. */
export function peopleNote(people: PeopleOutcome | null, names: ReadonlyMap<string, string | null>): string | null {
  if (!people) return null;
  if (people.failed) return "The people weren't added. Share the join link to bring them in.";
  if (people.skipped.length === 0) return null;
  const who = (id: string) => names.get(id) ?? "Someone";
  const first = people.skipped.slice(0, 2).map((s) => `${who(s.subjectId)} ${SKIP_WORDS[s.reason]}`);
  const more = people.skipped.length > 2 ? ` and ${people.skipped.length - 2} more weren't added` : "";
  return `${first.join("; ")}${more}.`;
}
