// spliteco.expense_for_you (cookpool-spliteco SE-6): everyone on an expense
// but whoever changed it hears it was added, edited, deleted, restored or
// moved — "Anu via Claude" when an assistant did it — after the write, and a
// failed send never fails the write. Cookpool's own rows are not told here.

import { SPLITECO_EMAILS, type SplitecoDraftResponse, type SplitecoExpenseForYouEmail, type SplitecoWriteResponse } from "@saas/contracts/spliteco";
import { sendExpenseForYou } from "@spliteco-worker/notify";
import type { RequestContext } from "@spliteco-worker/context";
import { ANU, DEV, ME, MEERA, add, envelope, equal, key, world } from "./helpers.js";
import type { Harness } from "./harness.js";

const DLG = "dlg_0123456789abcdef0123456789abcdef";
const claude = { "x-actor-delegation-id": DLG, "x-actor-scopes": "money.read,money.write", "x-actor-delegation-client": "Claude" };

function notices(h: Harness) {
  return h.sent
    .filter((s) => s.body.templateKey === SPLITECO_EMAILS.EXPENSE_FOR_YOU)
    .map((s) => ({ to: s.body.recipient.subjectId, key: s.body.idempotencyKey, actor: s.internalActor, data: s.body.templateData as SplitecoExpenseForYouEmail }));
}

const write = async (h: Harness, method: string, path: string, as: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await h.call(method, path, { as, ...(body === undefined ? {} : { body }), headers: { "idempotency-key": key(), ...headers } });
  return { res, env: await envelope<SplitecoWriteResponse>(res) };
};

describe("who is told", () => {
  it("everyone on an added expense but whoever added it, once each, with their share and a link", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(320000, ANU, [ME, ANU, DEV, MEERA], { title: "Sunset cruise" }), ANU);
    const sent = notices(h);
    expect(sent.map((n) => n.to).sort()).toEqual([ME, DEV, MEERA].sort());
    expect(sent.every((n) => n.actor === "spliteco-worker")).toBe(true);
    expect(sent.map((n) => n.key)).toEqual(sent.map((n) => `spliteco.expense_for_you:${e.id}:${n.to}`));
    expect(sent[0]!.data).toEqual({
      actorName: "Anu",
      change: "added",
      title: "Sunset cruise",
      amount: "₹3,200.00",
      groupName: "Goa Trip",
      fromGroupName: null,
      yourShare: "₹800.00",
      expenseUrl: `https://spliteco.test/expense?id=${encodeURIComponent(e.id)}`,
    });
  });

  it("an edit tells the people before and after — someone taken off reads as no longer on it", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(300000, ANU, [ME, ANU, DEV], { title: "Cruise" }), ANU);
    h.sent.length = 0;
    const edited = await write(h, "PUT", `/v1/spliteco/expenses/${e.id}`, ME, equal(300000, ANU, [ME, ANU], { title: "Cruise" }));
    expect(edited.res.status).toBe(200);
    const sent = notices(h);
    expect(sent.map((n) => [n.to, n.data.change, n.data.yourShare]).sort()).toEqual(
      [
        [ANU, "edited", "₹1,500.00"],
        [DEV, "edited", null],
      ].sort(),
    );
    expect(sent.every((n) => n.data.actorName === "You")).toBe(true);
  });

  it("delete, restore and move say so; a move names where it left", async () => {
    const { h, goa, flat } = world();
    const e = await add(h, goa, equal(1000, ME, [ME, ANU]), ME);
    h.sent.length = 0;
    await write(h, "DELETE", `/v1/spliteco/expenses/${e.id}`, ME);
    const restored = await write(h, "POST", `/v1/spliteco/expenses/${e.id}/restore`, ME);
    await write(h, "POST", `/v1/spliteco/expenses/${restored.env.data.expense.id}/move`, ME, { toGroupId: flat.publicId });
    const sent = notices(h);
    expect(sent.map((n) => [n.to, n.data.change, n.data.yourShare, n.data.groupName, n.data.fromGroupName])).toEqual([
      [ANU, "deleted", null, "Goa Trip", null],
      [ANU, "restored", "₹5.00", "Goa Trip", null],
      [ANU, "moved", "₹5.00", "Flat 4B", "Goa Trip"],
    ]);
    // Each change is its own notice (keyed by the row it wrote).
    expect(new Set(sent.map((n) => n.key)).size).toBe(3);
  });

  it("tells nobody when the only person on it made it, and nobody twice on a retried write", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(1000, ME, [ME]), ME);
    expect(notices(h)).toEqual([]);
    const k = key();
    const body = equal(1000, ME, [ME, ANU]);
    for (let i = 0; i < 2; i++) {
      const res = await h.call("POST", `/v1/spliteco/groups/${goa.publicId}/expenses`, { as: ME, body, headers: { "idempotency-key": k } });
      expect(res.ok).toBe(true);
    }
    expect(notices(h).map((n) => n.to)).toEqual([ANU]);
  });
});

describe("through an assistant", () => {
  it('says "<name> via Claude" on a saved draft, and the assistant\'s person is not told', async () => {
    const { h, goa } = world();
    const drafted = await h.call("POST", "/v1/spliteco/drafts", {
      as: ANU,
      headers: claude,
      body: { action: "add", groupId: goa.publicId, expense: equal(320000, ANU, [ME, ANU, DEV], { title: "Sunset cruise" }) },
    });
    const token = (await envelope<SplitecoDraftResponse>(drafted)).data.draft.token;
    expect(notices(h)).toEqual([]);
    const saved = await h.call("POST", `/v1/spliteco/drafts/${token}/save`, { as: ANU, headers: { ...claude, "idempotency-key": key() } });
    expect(saved.status).toBe(201);
    const sent = notices(h);
    expect(sent.map((n) => n.to).sort()).toEqual([ME, DEV].sort());
    expect(sent.every((n) => n.data.actorName === "Anu via Claude")).toBe(true);
    // A second save replays the expense and tells nobody again.
    await h.call("POST", `/v1/spliteco/drafts/${token}/save`, { as: ANU, headers: { ...claude, "idempotency-key": key() } });
    expect(notices(h)).toHaveLength(2);
  });

  it('a delete through an assistant reads "via Claude" too, and "via an assistant" without a name', async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(1000, ME, [ME, ANU]), ME);
    h.sent.length = 0;
    await write(h, "DELETE", `/v1/spliteco/expenses/${e.id}`, ME, undefined, { "x-actor-delegation-id": DLG, "x-actor-scopes": "money.write" });
    expect(notices(h).map((n) => n.data.actorName)).toEqual(["You via an assistant"]);
  });
});

describe("Cookpool's rows", () => {
  it("are not told about here: a Cookpool post sends no spliteco.expense_for_you", async () => {
    const { h, flat } = world();
    const res = await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: ANU,
      body: { title: "Vegetables", totalMinor: 900, mode: "equal", payers: [{ subjectId: ANU, amountMinor: 900 }], participants: [{ subjectId: ME }, { subjectId: ANU }, { subjectId: DEV }] },
      headers: { "idempotency-key": key() },
    });
    expect(res.status).toBe(201);
    expect(notices(h)).toEqual([]);
  });

  it("and the sender itself refuses an app = 'cookpool' row", async () => {
    const { h } = world();
    const ctx = { env: h.env, actor: { subjectId: ME, subjectType: "user", delegationId: null, scopes: [], clientName: null } } as unknown as RequestContext;
    const n = await sendExpenseForYou(ctx, {
      change: "edited",
      aboutTxnPublicId: "txn_1",
      expensePublicId: "txn_1",
      app: "cookpool",
      orgPublicId: "org_1",
      groupName: "Flat 4B",
      title: "Vegetables",
      totalMinor: 900,
      currency: "INR",
      before: [{ subjectId: ANU, owedMinor: 300 }],
      after: [{ subjectId: ANU, owedMinor: 300 }],
    });
    expect(n).toBe(0);
    expect(h.sent).toEqual([]);
  });
});

describe("a failed notification never fails the write", () => {
  const broken = (mode: "throw" | "500") =>
    ({
      fetch: async () => {
        if (mode === "throw") throw new Error("notifications-worker is down");
        return Response.json({ error: { code: "internal_error" } }, { status: 500 });
      },
      connect() {
        throw new Error("not implemented");
      },
    }) as unknown as Fetcher;

  it.each(["throw", "500"] as const)("when notifications-worker %s, every write still lands", async (mode) => {
    const { h, goa } = world({ env: { NOTIFICATIONS_WORKER: broken(mode) } });
    const e = await add(h, goa, equal(1000, ME, [ME, ANU, DEV]), ME);
    const edited = await write(h, "PUT", `/v1/spliteco/expenses/${e.id}`, ME, equal(1200, ME, [ME, ANU]));
    expect(edited.res.status).toBe(200);
    const deleted = await write(h, "DELETE", `/v1/spliteco/expenses/${edited.env.data.expense.id}`, ME);
    expect(deleted.res.status).toBe(200);
    const rows = h.db.prepare("SELECT kind FROM kitchen_txns ORDER BY rowid").all() as { kind: string }[];
    expect(rows.map((r) => r.kind)).toEqual(["expense", "expense", "reversal", "reversal"]);
  });

  it("and without the binding at all", async () => {
    const { h, goa } = world({ env: { NOTIFICATIONS_WORKER: undefined } });
    const e = await add(h, goa, equal(1000, ME, [ME, ANU]), ME);
    expect(e.totalMinor).toBe(1000);
  });
});
