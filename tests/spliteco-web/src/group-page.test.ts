import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { SplitecoExpenseSummary } from "@saas/contracts/spliteco";
import { BillDeletes, billMeta, billMonths, billShare, billWritable, holdHref, holdTiles, planRows, planTitle } from "@/lib/group-view";
import { DelayedSends, UNDO_MS, type Timers } from "@/lib/delayed";
import { EDGE_PX, pagerHearsStart, pagerRule } from "@saas/gestures/rules";
import { edgeSwipeRule, type ElementLike } from "@saas/gestures/gestures";

// spliteco-calm SL3 (design §2–§3, V2Group): the Group page's bills — which
// swipe to Delete, the delayed delete with Undo, the hold sheet per bill,
// months, Balances — and the edge swipe winning over the Bills ↔ Balances pager.

const APP = `${cwd()}/../../apps/spliteco-web/src`;
const read = (path: string) => readFileSync(`${APP}/${path}`, "utf8");
/** The shared gesture modules (packages/gestures, tripeco TR-5). */
const readGesture = (path: string) => readFileSync(`${APP}/../../../packages/gestures/src/${path}`, "utf8");
const ME = "usr_me";

function bill(over: Partial<SplitecoExpenseSummary> = {}): SplitecoExpenseSummary {
  return {
    id: "txn_1",
    groupId: "org_goa",
    groupName: "Goa Trip",
    kind: "expense",
    app: "spliteco",
    bucket: "other",
    title: "Scooter rent",
    category: "transport",
    method: "equal",
    totalMinor: 240000,
    currency: "INR",
    occurredAt: "2026-11-10T10:00:00.000Z",
    createdAt: "2026-11-10T10:00:00.000Z",
    createdBy: ME,
    payers: [{ subjectId: ME, paidMinor: 240000 }],
    splits: [
      { subjectId: ME, paidMinor: 240000, owedMinor: 60000 },
      { subjectId: "usr_dev", paidMinor: 0, owedMinor: 180000 },
    ],
    myNetMinor: 180000,
    locked: false,
    viaDelegation: null,
    viaAssistant: null,
    paymentMethod: null,
    ...over,
  };
}

const names = new Map<string, string | null>([
  ["usr_dev", "Dev"],
  ["usr_anu", "Anu"],
  ["usr_meera", "Meera"],
]);

describe("which bills swipe to Delete", () => {
  it("a Spliteco bill you can write does; Cookpool's, payments and a viewer's do not", () => {
    expect(billWritable(bill(), true)).toBe(true);
    expect(billWritable(bill({ app: "cookpool", locked: true }), true)).toBe(false);
    expect(billWritable(bill({ app: "cookpool", locked: false }), true)).toBe(false); // even if the lock were missing
    expect(billWritable(bill({ kind: "settlement", locked: true }), true)).toBe(false);
    expect(billWritable(bill(), false)).toBe(false);
  });

  it("the page offers the swipe only through billWritable (Cookpool rows get no action)", () => {
    const src = read("app/group/page.tsx");
    expect(src).toMatch(/const writable = billWritable\(e, canWrite\)/);
    expect(src).toMatch(/action=\{\s*writable \?/);
    expect(src).toMatch(/onFire=\{writable \? /);
    expect(src).toContain('actionTone="red"');
    expect(src).toContain('name="trash"');
  });
});

describe("the hold sheet", () => {
  it("Edit · Move · Comment for your bill; Open · Comment for Cookpool's, payments and viewers", () => {
    expect(holdTiles(bill(), true)).toEqual(["edit", "move", "comment"]);
    expect(holdTiles(bill({ app: "cookpool", locked: true }), true)).toEqual(["open", "comment"]);
    expect(holdTiles(bill({ kind: "settlement", locked: true }), true)).toEqual(["open", "comment"]);
    expect(holdTiles(bill(), false)).toEqual(["open", "comment"]);
  });

  it("each tile goes where the app already does it", () => {
    expect(holdHref("edit", "txn_1")).toBe("/add?edit=txn_1");
    expect(holdHref("move", "txn_1")).toBe("/move?id=txn_1");
    expect(holdHref("comment", "txn_1")).toBe("/expense?id=txn_1&comment=1");
    expect(holdHref("open", "txn_1")).toBe("/expense?id=txn_1");
    expect(read("app/expense/page.tsx")).toMatch(/useQueryParam\("comment"\) === "1"/);
  });
});

describe("bills by month", () => {
  it("newest first under the month's name; another year says its year", () => {
    const rows = [
      bill({ id: "a", occurredAt: "2026-11-10T10:00:00.000Z" }),
      bill({ id: "b", occurredAt: "2026-11-02T10:00:00.000Z" }),
      bill({ id: "c", occurredAt: "2026-10-20T10:00:00.000Z" }),
      bill({ id: "d", occurredAt: "2025-12-20T10:00:00.000Z" }),
    ];
    const months = billMonths(rows, new Date("2026-11-13T12:00:00.000Z"));
    expect(months.map(([m, r]) => [m, r.map((x) => x.id)])).toEqual([
      ["November", ["a", "b"]],
      ["October", ["c"]],
      ["December 2025", ["d"]],
    ]);
  });
});

describe("a bill's line", () => {
  it("who paid · total, then your share signed", () => {
    expect(billMeta(bill(), names, ME)).toBe("You paid · ₹2,400");
    expect(billMeta(bill({ payers: [{ subjectId: "usr_dev", paidMinor: 1 }, { subjectId: "usr_anu", paidMinor: 1 }] }), names, ME)).toBe("Dev and Anu paid · ₹2,400");
    expect(billShare(bill(), ME)).toEqual({ text: "+₹1,800", tone: "get", label: "you lent" });
    expect(billShare(bill({ myNetMinor: -124000 }), ME)).toEqual({ text: "−₹1,240", tone: "owe", label: "you borrowed" });
    expect(billShare(bill({ myNetMinor: 0, splits: [{ subjectId: "usr_dev", paidMinor: 1, owedMinor: 1 }] }), ME)).toEqual({ text: "not involved", tone: "even", label: "not involved" });
  });

  it("a payment reads who paid whom", () => {
    const pay = bill({ kind: "settlement", payers: [{ subjectId: "usr_meera", paidMinor: 1 }], splits: [{ subjectId: "usr_dev", paidMinor: 0, owedMinor: 1 }] });
    expect(billMeta(pay, names, ME)).toBe("Meera paid Dev");
  });
});

describe("Balances", () => {
  it("the plan's heading, and one row per payment, largest first, You for the caller", () => {
    expect(planTitle(true)).toBe("Fewest payments");
    expect(planTitle(false)).toBe("Pair by pair");
    const rows = planRows(
      {
        plan: [
          { fromSubjectId: "usr_anu", toSubjectId: "usr_dev", amountMinor: 26000 },
          { fromSubjectId: "usr_dev", toSubjectId: ME, amountMinor: 98000 },
        ],
      },
      names,
      ME,
    );
    expect(rows.map((r) => `${r.from}→${r.to} ${r.amountMinor}`)).toEqual(["Dev→You 98000", "Anu→Dev 26000"]);
  });
});

// ── The delayed delete ─────────────────────────────────────────────

function clock(): Timers & { advance(ms: number): void } {
  let now = 0;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let next = 1;
  return {
    set(run, ms) {
      const id = next++;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clear(handle) {
      timers = timers.filter((t) => t.id !== handle);
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.run();
    },
  };
}

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

function setup(result: (id: string) => Promise<unknown> = () => Promise.resolve({})) {
  const c = clock();
  const sent: string[] = [];
  const log: string[] = [];
  let hidden: string[] = [];
  const deletes = new BillDeletes(
    (id) => {
      sent.push(id);
      return result(id);
    },
    {
      change: (h) => {
        hidden = [...h];
      },
      deleted: (id) => log.push(`deleted ${id}`),
      failed: (id, err) => log.push(`failed ${id}: ${String(err)}`),
    },
    new DelayedSends(c),
  );
  return { c, sent, log, deletes, hidden: () => hidden };
}

describe("swipe → Delete, with a real Undo", () => {
  it("hides the row at once and sends only after UNDO_MS", async () => {
    const t = setup();
    expect(t.deletes.remove("txn_1")).toBe(true);
    expect(t.hidden()).toEqual(["txn_1"]);
    t.c.advance(UNDO_MS - 1);
    expect(t.sent).toEqual([]);
    t.c.advance(1);
    expect(t.sent).toEqual(["txn_1"]);
    await flushPromises();
    expect(t.log).toEqual(["deleted txn_1"]);
    expect(t.hidden()).toEqual(["txn_1"]); // stays hidden until the re-read drops it
  });

  it("Undo inside the window: no request at all, and the row is back", () => {
    const t = setup();
    t.deletes.remove("txn_1");
    t.c.advance(2000);
    expect(t.deletes.undo("txn_1")).toBe(true);
    expect(t.hidden()).toEqual([]);
    t.c.advance(10_000);
    expect(t.sent).toEqual([]);
  });

  it("Undo after it went does nothing", () => {
    const t = setup();
    t.deletes.remove("txn_1");
    t.c.advance(UNDO_MS);
    expect(t.deletes.undo("txn_1")).toBe(false);
    expect(t.sent).toEqual(["txn_1"]);
  });

  it("a refusal (Cookpool's 409) brings the row back and says why", async () => {
    const t = setup(() => Promise.reject(new Error("owned_by_cookpool")));
    t.deletes.remove("txn_1");
    t.c.advance(UNDO_MS);
    await flushPromises();
    expect(t.hidden()).toEqual([]);
    expect(t.log).toEqual(["failed txn_1: Error: owned_by_cookpool"]);
  });

  it("one delete per row while it waits; leaving the page sends what is waiting", () => {
    const t = setup();
    t.deletes.remove("txn_1");
    expect(t.deletes.remove("txn_1")).toBe(false);
    t.deletes.remove("txn_2");
    t.deletes.flush();
    expect(t.sent).toEqual(["txn_1", "txn_2"]);
  });

  it("the page wires it: the toast's Undo, a flush on leaving, the reason on refusal", () => {
    const src = read("app/group/page.tsx");
    expect(src).toContain("new BillDeletes(");
    expect(src).toContain("deleteExpense(");
    expect(src).toMatch(/text: "Deleted",\s*undo:/);
    expect(src).toContain('window.addEventListener("pagehide", leave)');
    expect(src).toMatch(/Not deleted · \$\{errorText\(err\)\}/);
  });
});

// ── Edge back vs the pager ─────────────────────────────────────────

describe("from the left edge is back, not Bills ↔ Balances", () => {
  const frame: ElementLike = { parentElement: null, scrollTop: 0, scrollLeft: 0, scrollHeight: 100, scrollWidth: 100, clientHeight: 100, clientWidth: 100, closest: () => null };
  const styleOf = () => ({ overflowX: "visible", overflowY: "visible" });

  it("a drag that starts within EDGE_PX is the edge swipe's on a pushed screen", () => {
    expect(EDGE_PX).toBe(20);
    expect(edgeSwipeRule({ x: 10, y: 300, t: 0 }, frame, frame, styleOf)?.(40, 2)).toBe(true);
    expect(pagerHearsStart(10, true)).toBe(false);
    expect(pagerHearsStart(EDGE_PX, true)).toBe(false);
    expect(pagerHearsStart(EDGE_PX + 1, true)).toBe(true);
    // Further in, the pager has it and the edge swipe does not.
    expect(edgeSwipeRule({ x: 60, y: 300, t: 0 }, frame, frame, styleOf)).toBeNull();
    expect(pagerRule(frame)?.(-40, 2)).toBe(true);
  });

  it("the tab surface keeps its pager to the edge (no edge back there)", () => {
    expect(pagerHearsStart(5, false)).toBe(true);
    expect(read("components/tab-surface.tsx")).not.toContain("leaveEdge");
  });

  it("Group's pager leaves the edge, and every pushed screen has edge back", () => {
    expect(read("app/group/page.tsx")).toMatch(/usePager\(\{[^}]*leaveEdge: true/);
    expect(readGesture("react/pager.ts")).toContain("pagerHearsStart(start.x, live.current.leaveEdge)");
    for (const page of ["group", "expense", "move", "add", "settle", "insights", "share", "scan", "live", "live/[code]"]) {
      expect([page, read(`app/${page}/page.tsx`).includes("<Screen nav={false}>")]).toEqual([page, true]);
    }
  });
});

describe("one main action", () => {
  it("the Add pill is the Group page's only add", () => {
    const src = read("app/group/page.tsx");
    expect(src.match(/href=\{to\(`\/add\?group=/g)?.length).toBe(1);
    expect(src).toContain('className="add-pill"');
    expect(src).not.toContain("Add expense");
    expect(src).not.toContain('className="fab"');
  });
});
