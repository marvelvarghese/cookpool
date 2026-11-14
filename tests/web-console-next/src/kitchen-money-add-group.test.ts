import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import {
  EMPTY_ADD_GROUP,
  GROUPS_PER_PERSON_MESSAGE,
  RULES_NOT_SAVED,
  createGroup,
  currencyChoice,
  type AddGroupApi,
} from "@web-console-next/components/kitchen/money-add-group";
import { GROUP_CURRENCIES } from "@web-console-next/components/kitchen/groups";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (p: string) => readFileSync(`${root}/${p}`, "utf8");

const org = { id: "org_1", name: "Flat 4B", slug: "flat-4b-abc123", createdAt: "2026-01-01T00:00:00Z" };
const settings = { currency: "INR", wastePolicy: "split_equally", updatedAt: "2026-01-01T00:00:00Z" };

function fakeApi(over: { create?: unknown; save?: unknown } = {}) {
  const calls = { create: [] as unknown[], save: [] as unknown[] };
  const api = {
    createOrganization: async (b: unknown) => (calls.create.push(b), over.create ?? { ok: true, data: { organization: org } }),
    saveSettings: async (id: string, b: unknown) => (calls.save.push([id, b]), over.save ?? { ok: true, data: settings }),
  } as unknown as AddGroupApi;
  return { api, calls };
}

describe("Add group: entry points", () => {
  it("opens from + Group and the Add group row, both through the one route", () => {
    expect(read("components/kitchen/money-native-ui.tsx")).toContain("go(MONEY_ADD_GROUP_HREF)");
    const ui = read("components/kitchen/money-native-ui.tsx");
    expect(ui).toContain("onAddGroup={addGroup}");
    expect(ui).toContain("MoneyHeader side={side} onSide={onSide} {...(side === \"groups\" ? { onAddGroup: addGroup }");
    expect(read("app/(kitchen)/money/add-group/page.tsx")).toContain("MoneyAddGroup");
    expect(read("components/kitchen/money-add-group-ui.tsx")).toContain("<AddGroupSheet open");
  });

  it("has the fields, the slot above Name, and one create button", () => {
    const ui = read("components/kitchen/money-add-group-ui.tsx");
    expect(ui.indexOf("startFromSlot ?")).toBeLessThan(ui.indexOf('id="add-group-name"'));
    for (const t of ["Add group", "Currency", "When food goes to waste", "People", "Share join link", "Create group"]) expect(ui).toContain(t);
    expect(ui).toContain("WASTE_RULES.map");
    expect(ui).toContain("GROUP_CURRENCIES.map");
  });
});

describe("Add group: creating", () => {
  it("defaults to INR and splitting equally", () => {
    expect(EMPTY_ADD_GROUP).toEqual({ name: "", currency: "INR", waste: "split_equally" });
  });

  it("happy path: creates the organization, then saves its one currency and food rule", async () => {
    const { api, calls } = fakeApi();
    const out = await createGroup(api, { name: "  Flat 4B ", currency: "USD", waste: "buyer_absorbs" }, "abc123");
    expect(out).toMatchObject({ ok: true, org, settingsError: null });
    expect(calls.create).toEqual([{ name: "Flat 4B", slug: expect.stringContaining("abc123") }]);
    expect(calls.save).toEqual([["org_1", { currency: "USD", wastePolicy: "buyer_absorbs" }]]);
  });

  it("validates the name before any call", async () => {
    const { api, calls } = fakeApi();
    const out = await createGroup(api, { ...EMPTY_ADD_GROUP, name: "   " }, "x");
    expect(out.ok).toBe(false);
    expect(calls.create).toEqual([]);
  });

  it("shows the server's message when creating fails, and the groups limit in plain words", async () => {
    const a = fakeApi({ create: { ok: false, error: { reason: "x", message: "Name taken" } } });
    expect(await createGroup(a.api, { ...EMPTY_ADD_GROUP, name: "Flat" }, "x")).toEqual({ ok: false, message: "Name taken" });
    expect(a.calls.save).toEqual([]);
    const b = fakeApi({ create: { ok: false, error: { reason: "groups_per_person", message: "limit" } } });
    expect(await createGroup(b.api, { ...EMPTY_ADD_GROUP, name: "Flat" }, "x")).toEqual({ ok: false, message: GROUPS_PER_PERSON_MESSAGE });
  });

  it("keeps the group and says so when the food rule fails to save", async () => {
    const { api } = fakeApi({ save: { ok: false, error: { reason: "x", message: "boom" } } });
    expect(await createGroup(api, { ...EMPTY_ADD_GROUP, name: "Flat" }, "x")).toMatchObject({ ok: true, org, settings: null, settingsError: RULES_NOT_SAVED });
  });

  it("only accepts a currency from the list", () => {
    for (const c of GROUP_CURRENCIES) expect(currencyChoice(c.code)).toBe(c.code);
    expect(currencyChoice("XYZ")).toBe("INR");
  });
});
