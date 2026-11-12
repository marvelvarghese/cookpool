// SE4: the Live split screen as data — the draft it opens from, the claimed
// bar, "I had this", who is here, the lock button — and the polling that
// refreshes it every 2 s while the page is visible.

import { SPLITECO_LIVE_POLL_MS, type SplitecoLiveSession } from "@saas/contracts/spliteco";
import { claimersOf, hereLine, inviteText, keepPolling, liveDraftFrom, liveUrl, lockState, progress, tickerLine, toggleMine, unclaimed } from "@/lib/live";
import { createPoller, type PollClock, type PollPage } from "@/lib/poll";
import { safeReturnPath, takeReturn, rememberReturn } from "@/lib/return-to";
import { newForm, type ExpenseForm } from "@/lib/split-form";
import { qrPath } from "@/lib/qr";

const ME = "usr_me", ANU = "usr_anu", DEV = "usr_dev", MEERA = "usr_meera";
const names = new Map<string, string | null>([[ME, "Ravi"], [ANU, "Anu"], [DEV, "Dev"], [MEERA, "Meera"]]);

function itemizedForm(): ExpenseForm {
  const f = newForm([ME, ANU, DEV], ME, "items");
  f.title = "Beach shack dinner";
  f.items = [
    { key: "a", name: "Prawn curry", qtyText: "1", unitText: "", totalText: "680", shares: { [ANU]: { mode: "portion", value: 1000 } } },
    { key: "b", name: "Kingfisher", qtyText: "6", unitText: "180", totalText: "", shares: {} },
  ];
  f.adjustments = [{ key: "t", kind: "tax", label: "", mode: "pct", valueText: "5" }];
  return f;
}

const session = (over: Partial<SplitecoLiveSession> = {}): SplitecoLiveSession => ({
  id: "lvs_1",
  code: "KTCH2345",
  groupId: "org_1",
  groupName: "Goa Trip",
  currency: "INR",
  state: "open",
  createdBy: ME,
  createdAt: "2026-11-12T20:00:00.000Z",
  expiresAt: "2026-11-13T20:00:00.000Z",
  draft: {
    title: "Beach shack dinner",
    payers: [{ subjectId: ME, amountMinor: 186900 }],
    items: [{ name: "Prawn curry", totalMinor: 68000 }, { name: "Kingfisher", qty: 6, totalMinor: 108000 }],
    adjustments: [{ kind: "tax", label: "Tax 5%", amountMinor: 8800 }],
  },
  totalMinor: 184800,
  itemsMinor: 176000,
  claimedMinor: 68000,
  claims: [{ itemPosition: 0, subjectId: ANU, mode: "portion", value: 1000, updatedAt: "2026-11-12T20:00:10.000Z" }],
  here: [{ subjectId: ANU, seenAt: "2026-11-12T20:00:10.000Z" }, { subjectId: ME, seenAt: "2026-11-12T20:00:09.000Z" }],
  members: [ME, ANU, DEV, MEERA].map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })),
  expenseId: null,
  ...over,
});

describe("opening a live split from the Itemized screen", () => {
  it("sends the items, the tax as an amount, who paid, and the shares already set", () => {
    const out = liveDraftFrom(itemizedForm());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.request).toMatchObject({
      title: "Beach shack dinner",
      payers: [{ subjectId: ME, amountMinor: 184800 }],
      items: [{ name: "Prawn curry", qty: 1, totalMinor: 68000 }, { name: "Kingfisher", qty: 6, totalMinor: 108000 }],
      adjustments: [{ kind: "tax", label: "Tax 5%", amountMinor: 8800 }],
      claims: [{ itemPosition: 0, subjectId: ANU, mode: "portion", value: 1000 }],
    });
  });

  it("says what is missing first", () => {
    const f = itemizedForm();
    expect(liveDraftFrom({ ...f, title: "" })).toEqual({ ok: false, why: "Say what it was for first" });
    expect(liveDraftFrom({ ...f, items: [{ ...f.items[0]!, totalText: "" }] })).toEqual({ ok: false, why: "Add the price of Prawn curry" });
    expect(liveDraftFrom({ ...f, method: "equal" })).toMatchObject({ ok: false });
  });
});

describe("the Live split screen", () => {
  it("shows what is claimed, and what is left", () => {
    expect(progress(session())).toEqual({ left: "₹680 of ₹1,760 claimed", right: "₹1,080 left", ratio: 68000 / 176000, done: false });
    expect(unclaimed(session())).toEqual([1]);
    const all = session({ claimedMinor: 176000, claims: [...session().claims, { itemPosition: 1, subjectId: DEV, mode: "portion", value: 1000, updatedAt: "2026-11-12T20:00:20.000Z" }] });
    expect(progress(all)).toMatchObject({ right: "All claimed", done: true, ratio: 1 });
    expect(claimersOf(all, 1)).toEqual([DEV]);
  });

  it("toggles my own claim with I had this", () => {
    expect(toggleMine(session(), 1, ME)).toEqual({ itemPosition: 1, mode: "portion", value: 1000 });
    expect(toggleMine(session(), 0, ANU)).toEqual({ itemPosition: 0, clear: true });
  });

  it("says who is here, me first", () => {
    expect(hereLine(session(), names, ME)).toBe("You, Anu here · 2 more in the group");
    expect(hereLine(session({ here: [] }), names, ME)).toBe("Nobody here yet · 4 more in the group");
  });

  it("ticks the newest claim", () => {
    expect(tickerLine(session(), names, ME, new Date("2026-11-12T20:00:30.000Z"))).toBe("Anu claimed Prawn curry · just now");
    expect(tickerLine(session({ claims: [] }), names, ME)).toBeNull();
  });

  it("lets only the opener lock, once everything is claimed", () => {
    expect(lockState(session(), ME)).toEqual({ show: true, enabled: false, label: "1 item still unclaimed" });
    expect(lockState(session(), ANU).show).toBe(false);
    const all = session({ claims: [...session().claims, { itemPosition: 1, subjectId: DEV, mode: "portion", value: 1000, updatedAt: "x" }] });
    expect(lockState(all, ME)).toEqual({ show: true, enabled: true, label: "Everything's claimed — lock the bill" });
    expect(lockState(all, ANU)).toMatchObject({ show: true, enabled: false });
    expect(lockState(session({ state: "locked" }), ME).show).toBe(false);
  });

  it("links and encodes the join address as a real QR code", () => {
    expect(liveUrl("https://spliteco.test/", "KTCH2345")).toBe("https://spliteco.test/live/KTCH2345");
    expect(inviteText(session(), "https://spliteco.test")).toBe('Claim what you had on "Beach shack dinner" — https://spliteco.test/live/KTCH2345 (code KTCH-2345)');
    const qr = qrPath("https://spliteco.test/live/KTCH2345");
    expect(qr.size).toBeGreaterThanOrEqual(25); // version 2 or more: 25×25 modules and up
    expect((qr.d.match(/M/g) ?? []).length).toBeGreaterThan(100);
    expect(qrPath("https://spliteco.test/live/KTCH2345").d).toBe(qr.d);
    expect(qrPath("https://spliteco.test/live/KTCH2346").d).not.toBe(qr.d);
  });
});

/** A clock and a page the test turns by hand. */
function fakes() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let hidden = false;
  const listeners = new Set<() => void>();
  const clock: PollClock = {
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
  };
  const page: PollPage = {
    hidden: () => hidden,
    onVisibility(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    clock,
    page,
    pending: () => timers.size,
    listeners: () => listeners.size,
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        t = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
    async setHidden(h: boolean) {
      hidden = h;
      for (const fn of listeners) fn();
      await flush();
    },
    flush,
  };
}

describe("polling the live split", () => {
  it("reads at once, then every 2 seconds", async () => {
    const f = fakes();
    let reads = 0;
    const p = createPoller(async () => void reads++, SPLITECO_LIVE_POLL_MS, f.page, f.clock);
    p.start();
    await f.flush();
    expect(reads).toBe(1);
    await f.advance(1999);
    expect(reads).toBe(1);
    await f.advance(1);
    expect(reads).toBe(2);
    await f.advance(6000);
    expect(reads).toBe(5);
    p.stop();
  });

  it("stops while the page is hidden, and reads at once when it is back", async () => {
    const f = fakes();
    let reads = 0;
    const p = createPoller(async () => void reads++, 2000, f.page, f.clock);
    p.start();
    await f.flush();
    await f.setHidden(true);
    expect(f.pending()).toBe(0);
    expect(p.running).toBe(false);
    await f.advance(60_000);
    expect(reads).toBe(1);
    await f.setHidden(false);
    expect(reads).toBe(2);
    await f.advance(2000);
    expect(reads).toBe(3);
    p.stop();
  });

  it("never overlaps a slow read, and waits 2 seconds after it answers", async () => {
    const f = fakes();
    let reads = 0;
    let release: (() => void) | null = null;
    const p = createPoller(
      () => {
        reads++;
        return new Promise<void>((r) => (release = r));
      },
      2000,
      f.page,
      f.clock,
    );
    p.start();
    await f.advance(10_000);
    expect(reads).toBe(1);
    expect(f.pending()).toBe(0);
    release!();
    await f.flush();
    expect(f.pending()).toBe(1);
    await f.advance(2000);
    expect(reads).toBe(2);
    p.stop();
  });

  it("keeps going after a failed read", async () => {
    const f = fakes();
    let reads = 0;
    const p = createPoller(async () => {
      reads++;
      throw new Error("offline");
    }, 2000, f.page, f.clock);
    p.start();
    await f.flush();
    await f.advance(4000);
    expect(reads).toBe(3);
    p.stop();
  });

  it("stops for good once stopped (the screen left, or the bill was locked)", async () => {
    const f = fakes();
    let reads = 0;
    const p = createPoller(async () => void reads++, 2000, f.page, f.clock);
    p.start();
    await f.flush();
    p.stop();
    expect(f.pending()).toBe(0);
    expect(f.listeners()).toBe(0);
    await f.setHidden(true);
    await f.setHidden(false);
    await f.advance(10_000);
    p.kick();
    expect(reads).toBe(1);
    expect(keepPolling(session({ state: "locked" }))).toBe(false);
    expect(keepPolling(session({ state: "expired" }))).toBe(false);
    expect(keepPolling(session())).toBe(true);
  });

  it("reads again at once on a kick (after a claim), without doubling the rhythm", async () => {
    const f = fakes();
    let reads = 0;
    const p = createPoller(async () => void reads++, 2000, f.page, f.clock);
    p.start();
    await f.advance(1000);
    p.kick();
    await f.flush();
    expect(reads).toBe(2);
    expect(f.pending()).toBe(1);
    await f.advance(1999);
    expect(reads).toBe(2);
    await f.advance(1);
    expect(reads).toBe(3);
    p.stop();
  });
});

describe("back to the link after signing in", () => {
  it("returns only to a path on this app", () => {
    expect(safeReturnPath("/live/KTCH2345")).toBe("/live/KTCH2345");
    expect(safeReturnPath("/group?id=org_1")).toBe("/group?id=org_1");
    for (const bad of ["https://evil.test/", "//evil.test", "/\\evil.test", "/sign-in", "/auth/callback", "live", "", null]) expect(safeReturnPath(bad)).toBeNull();
  });

  it("is read once", () => {
    const store = new Map<string, string>();
    const s = { setItem: (k: string, v: string) => void store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
    rememberReturn(s, "/live/KTCH2345");
    expect(takeReturn(s)).toBe("/live/KTCH2345");
    expect(takeReturn(s)).toBe("/");
    rememberReturn(s, "//evil.test");
    expect(takeReturn(s)).toBe("/");
  });
});
