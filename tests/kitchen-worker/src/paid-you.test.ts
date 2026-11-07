// Someone paid you (PW-5): recording a payment asks notifications-worker to
// tell the person paid (`kitchen.paid_you`), once per payment, after the write
// commits — never when they recorded it themselves. Through the router,
// against real SQLite and the real policy grants; notifications-worker is the
// harness's recorder.

import type { KitchenTxn } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness, type RecordedNotification } from "./harness.js";

const NOW = new Date("2026-11-07T12:00:00.000Z");

const OWNER = "usr_rahul";
const ADMIN = "usr_admin";
const ANU = "usr_anu";
const DEV = "usr_dev";

let h: Harness;
let flat: Group;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  h.grant(OWNER, flat, "owner");
  h.grant(ADMIN, flat, "admin");
  h.grant(ANU, flat, "builder");
  h.grant(DEV, flat, "builder");
  for (const [who, name] of [[OWNER, "Rahul"], [ADMIN, "Meera"], [ANU, "Anu"], [DEV, "Dev"]] as const) {
    h.profile(who, { displayName: name, email: `${name.toLowerCase()}@example.com` });
  }
});

afterEach(() => h.close());

async function pay(as: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<{ status: number; body: Envelope<{ txn: KitchenTxn }> }> {
  const res = await h.call("POST", `/v1/organizations/${flat.publicId}/kitchen/settlements`, {
    as,
    body,
    ...(headers ? { headers } : {}),
  });
  return { status: res.status, body: await envelope<{ txn: KitchenTxn }>(res) };
}

const sent = (): RecordedNotification[] => h.notifications.filter((n) => n.request.templateKey === "kitchen.paid_you");
const firstSends = (): RecordedNotification[] => sent().filter((n) => !n.replayed);

describe("the payment notification", () => {
  it("tells the person paid who paid them, how much and how, once per payment", async () => {
    const res = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 40000, method: "upi" });
    expect(res.status).toBe(201);
    const txn = res.body.data.txn;

    expect(firstSends()).toHaveLength(1);
    const [mail] = firstSends();
    expect(mail!.internalActor).toBe("kitchen-worker");
    expect(mail!.request).toEqual({
      orgId: flat.publicId,
      category: "product",
      templateKey: "kitchen.paid_you",
      templateData: {
        payerName: "Dev",
        amount: "₹400.00",
        method: "UPI",
        groupName: "Flat 4B",
        personUrl: `https://cookpool.test/people/${DEV}`,
      },
      recipient: { channel: "email", address: "anu@example.com", subjectKind: "user", subjectId: ANU },
      idempotencyKey: `kitchen.paid_you:${txn.id}:${ANU}`,
      correlationId: expect.any(String),
    });

    // Another payment is another notification.
    const again = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 100, method: "cash" });
    expect(firstSends().map((n) => n.request.idempotencyKey)).toEqual([
      `kitchen.paid_you:${txn.id}:${ANU}`,
      `kitchen.paid_you:${again.body.data.txn.id}:${ANU}`,
    ]);
    expect(firstSends()[1]!.request.templateData).toMatchObject({ amount: "₹1.00", method: "Cash" });
  });

  it("asks again for a retried request, under the same key, so nothing is sent twice", async () => {
    const headers = { "idempotency-key": "pay-once" };
    const first = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 40000, method: "upi" }, headers);
    const retried = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 40000, method: "upi" }, headers);
    expect(retried.body.data.txn.id).toBe(first.body.data.txn.id);
    expect(sent()).toHaveLength(2);
    expect(firstSends()).toHaveLength(1);
    expect(new Set(sent().map((n) => n.request.idempotencyKey)).size).toBe(1);
  });

  it("is never sent for a payment the person paid recorded themselves", async () => {
    expect((await pay(ANU, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 40000, method: "upi" })).status).toBe(201);
    expect(sent()).toEqual([]);
  });

  it("is sent when an owner or admin records it for the two, and says who paid", async () => {
    expect((await pay(ADMIN, { fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 2500 })).status).toBe(201);
    expect(firstSends().map((n) => [n.request.recipient.subjectId, n.request.templateData])).toEqual([
      [DEV, { payerName: "Anu", amount: "₹25.00", method: null, groupName: "Flat 4B", personUrl: `https://cookpool.test/people/${ANU}` }],
    ]);
    // An owner who is the one paid recorded it: they know.
    expect((await pay(OWNER, { fromSubjectId: ANU, toSubjectId: OWNER, amountMinor: 2500, method: "other" })).status).toBe(201);
    expect(firstSends()).toHaveLength(1);
  });

  it("is not sent for a refused payment, nor for an expense", async () => {
    expect((await pay(DEV, { fromSubjectId: DEV, toSubjectId: DEV, amountMinor: 100 })).status).toBe(422);
    const expense = await h.call("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: DEV,
      body: { title: "Milk", totalMinor: 6000, payers: [{ subjectId: DEV, amountMinor: 6000 }], mode: "equal", participants: [{ subjectId: DEV }, { subjectId: ANU }] },
    });
    expect(expense.status).toBe(201);
    expect(sent()).toEqual([]);
  });

  it("never fails the write: notifications-worker down, or identity unreadable", async () => {
    h.failNotifications = true;
    expect((await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 100 })).status).toBe(201);
    h.failNotifications = false;
    h.failIdentity = true;
    expect((await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 100 })).status).toBe(201);
    expect(sent()).toEqual([]);
  });

  it("is handed to waitUntil, after the write, when the runtime offers one", async () => {
    const deferred: Promise<unknown>[] = [];
    h.close();
    h = createHarness({ deps: { now: () => NOW, waitUntil: (work) => deferred.push(work) } });
    h.grant(ANU, flat, "builder");
    h.grant(DEV, flat, "builder");
    h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
    h.profile(DEV, { displayName: "Dev", email: "dev@example.com" });
    const res = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 100 });
    expect(res.status).toBe(201);
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect(firstSends().map((n) => n.request.recipient.subjectId)).toEqual([ANU]);
  });
});
