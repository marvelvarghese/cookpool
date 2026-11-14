import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { SplitecoActivityEntry, SplitecoFriendBalance, SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { HOME_PEOPLE, fromKitchen, mainBalance, netLabel, pagerIndexOf, pagerPath, remindErrorText, planNote, rowAction, settleHref, signedShort } from "@/lib/home";
import { DelayedSends, UNDO_MS, type Timers } from "@/lib/delayed";
import { activityAmount, activityWhat, byDay, dayLabel, viaName } from "@/lib/activity-text";

// spliteco-calm SL2 (design §2–§3, V2Home): Home, Groups and Activity as one
// swipeable surface — the rules, and the pages read from the app's source.

const APP = `${cwd()}/../../apps/spliteco-web/src`;
const read = (path: string) => readFileSync(`${APP}/${path}`, "utf8");
/** The shared gesture modules (packages/gestures, tripeco TR-5). */
const readGesture = (path: string) => readFileSync(`${APP}/../../../packages/gestures/src/${path}`, "utf8");

function person(over: Partial<SplitecoFriendBalance> = {}): SplitecoFriendBalance {
  return { subjectId: "usr_meera", name: "Meera", balances: [], groupNames: [], outsideGroups: false, ...over };
}

function group(over: Partial<SplitecoGroupSummary> = {}): SplitecoGroupSummary {
  return { id: "org_goa", name: "Goa Trip", kind: "trip", madeIn: "spliteco", role: "builder", currency: "INR", memberCount: 4, myBalanceMinor: 0, myPlan: [], myBuckets: null, ...over };
}

describe("tabs ↔ addresses", () => {
  it("opens on the address's tab; You and pushed screens are not pager tabs", () => {
    expect(["/", "/groups", "/groups/", "/activity", "/you", "/group", "/settle", null].map(pagerIndexOf)).toEqual([0, 1, 1, 2, -1, -1, -1, -1]);
  });

  it("writes each tab's address back, Groups keeping Friends", () => {
    expect([0, 1, 2].map((i) => pagerPath(i))).toEqual(["/", "/groups", "/activity"]);
    expect(pagerPath(1, { friends: true })).toBe("/groups?tab=friends");
    expect(pagerPath(0, { friends: true })).toBe("/");
    expect(pagerPath(1.4)).toBe("/groups");
    expect(pagerPath(9)).toBe("/activity");
    expect(pagerPath(-3)).toBe("/");
  });
});

describe("signed amounts (design §1)", () => {
  it("+₹ teal when you get back, −₹ coral when you owe, plain at zero", () => {
    expect(signedShort(241_000)).toEqual({ text: "+₹2,410", tone: "get" });
    expect(signedShort(-86_050)).toEqual({ text: "−₹860.50", tone: "owe" });
    expect(signedShort(0)).toEqual({ text: "₹0", tone: "even" });
    expect(signedShort(1_200, "USD")).toEqual({ text: "+$12", tone: "get" });
  });

  it("labels the net without a sentence", () => {
    expect([1, -1, 0].map(netLabel)).toEqual(["You get back", "You owe", "All square"]);
  });

  it("shows INR first, else the first open balance", () => {
    expect(mainBalance([{ currency: "USD", amountMinor: 5 }, { currency: "INR", amountMinor: -9 }])).toEqual({ currency: "INR", amountMinor: -9 });
    expect(mainBalance([{ currency: "INR", amountMinor: 0 }, { currency: "USD", amountMinor: 5 }])).toEqual({ currency: "USD", amountMinor: 5 });
    expect(mainBalance([{ currency: "INR", amountMinor: 0 }])).toBeNull();
  });
});

describe("a person's row on Home", () => {
  it("swipes to Settle when you owe, Remind when they owe, nothing when square", () => {
    expect(rowAction(person({ balances: [{ currency: "INR", amountMinor: -86_000 }] }))).toBe("settle");
    expect(rowAction(person({ balances: [{ currency: "INR", amountMinor: 241_000 }] }))).toBe("remind");
    expect(rowAction(person({ balances: [{ currency: "INR", amountMinor: 0 }] }))).toBeNull();
    expect(HOME_PEOPLE).toBe(3);
  });

  it("follows the groups' plans, as the server does (SL-8)", () => {
    const owesMe = person({ balances: [{ currency: "INR", amountMinor: 11_000 }] });
    const id = owesMe.subjectId;
    // Debts simplified away: they owe you overall but pay someone else, so no Remind (the server would say nothing_owed).
    expect(rowAction(owesMe, [group({ myPlan: [] })])).toBeNull();
    expect(planNote(owesMe, [group({ myPlan: [] })])).toBe("Simplified: settled through others");
    // The plan has them paying you: Remind.
    expect(rowAction(owesMe, [group({ myPlan: [{ subjectId: id, amountMinor: 11_000 }] })])).toBe("remind");
    expect(planNote(owesMe, [group({ myPlan: [{ subjectId: id, amountMinor: 11_000 }] })])).toBeNull();
    // Net says they owe you, but the only plan entry is you paying them: Settle.
    expect(rowAction(owesMe, [group({ myPlan: [{ subjectId: id, amountMinor: -5_000 }] })])).toBe("settle");
    const iOwe = person({ balances: [{ currency: "INR", amountMinor: -86_000 }] });
    expect(rowAction(iOwe, [group({ myPlan: [{ subjectId: iOwe.subjectId, amountMinor: -86_000 }] })])).toBe("settle");
    expect(rowAction(iOwe, [group({ myPlan: [{ subjectId: "usr_someone_else", amountMinor: -86_000 }] })])).toBeNull();
    // Before the groups load, the net balance decides.
    expect(rowAction(owesMe, null)).toBe("remind");
    expect(planNote(owesMe, null)).toBeNull();
  });

  it("settles straight in the one group you pay them in, else the Settle list", () => {
    const pay = group({ id: "org_flat", myPlan: [{ subjectId: "usr_zoya", amountMinor: -86_000 }] });
    const get = group({ id: "org_goa", myPlan: [{ subjectId: "usr_zoya", amountMinor: 10_000 }] });
    expect(settleHref("usr_zoya", [pay, get])).toBe("/settle?group=org_flat&to=usr_zoya");
    expect(settleHref("usr_zoya", [pay, { ...pay, id: "org_two" }])).toBe("/settle");
    expect(settleHref("usr_zoya", null)).toBe("/settle");
  });

  it("dots a person whose balance is in a Cookpool kitchen", () => {
    const kitchen = group({ id: "org_k", name: "Flat 4B", madeIn: "cookpool", kind: "kitchen", myPlan: [{ subjectId: "usr_zoya", amountMinor: -1 }] });
    const trip = group({ myPlan: [{ subjectId: "usr_meera", amountMinor: 5 }] });
    expect(fromKitchen(person({ subjectId: "usr_zoya" }), [kitchen, trip])).toBe(true);
    expect(fromKitchen(person({ subjectId: "usr_meera", groupNames: ["Flat 4B", "Goa Trip"] }), [kitchen, trip])).toBe(false);
    // No plan names them (simplified away): a shared kitchen by name.
    expect(fromKitchen(person({ subjectId: "usr_dev", groupNames: ["Flat 4B"] }), [kitchen, trip])).toBe(true);
    expect(fromKitchen(person(), null)).toBe(false);
  });

  it("says why a reminder did not go", () => {
    expect(remindErrorText("reminded_recently", "Meera", "x")).toBe("You reminded Meera in the last 24 hours");
    expect(remindErrorText("nothing_owed", "Meera", "x")).toBe("Meera doesn't owe you anything now");
    expect(remindErrorText(null, "Meera", "Network down")).toBe("Network down");
  });
});

describe("Remind's Undo is real: the send waits", () => {
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

  it("sends after UNDO_MS (about 4 s), not before", () => {
    const c = clock();
    const sends = new DelayedSends(c);
    const sent: string[] = [];
    expect(UNDO_MS).toBe(4000);
    sends.schedule("usr_meera", () => sent.push("meera"));
    c.advance(UNDO_MS - 1);
    expect(sent).toEqual([]);
    expect(sends.isWaiting("usr_meera")).toBe(true);
    c.advance(1);
    expect(sent).toEqual(["meera"]);
    expect(sends.isWaiting("usr_meera")).toBe(false);
  });

  it("Undo inside the window means nothing is sent; after it, Undo has nothing to take back", () => {
    const c = clock();
    const sends = new DelayedSends(c);
    const sent: string[] = [];
    sends.schedule("a", () => sent.push("a"));
    expect(sends.undo("a")).toBe(true);
    c.advance(10_000);
    expect(sent).toEqual([]);
    sends.schedule("b", () => sent.push("b"));
    c.advance(UNDO_MS);
    expect(sends.undo("b")).toBe(false);
    expect(sent).toEqual(["b"]);
  });

  it("one waiting send per person, and leaving the page sends what is waiting", () => {
    const c = clock();
    const sends = new DelayedSends(c);
    const sent: string[] = [];
    expect(sends.schedule("a", () => sent.push("a1"))).toBe(true);
    expect(sends.schedule("a", () => sent.push("a2"))).toBe(false);
    sends.schedule("b", () => sent.push("b"));
    sends.flush();
    expect(sent).toEqual(["a1", "b"]);
    c.advance(UNDO_MS);
    expect(sent).toEqual(["a1", "b"]);
  });
});

describe("Activity: one line per change, under its day", () => {
  const base: SplitecoActivityEntry = {
    txnId: "txn_1",
    expenseId: "txn_1",
    action: "added",
    at: "2026-11-12T10:00:00.000Z",
    actorId: "usr_anu",
    groupId: "org_1",
    groupName: "Goa Trip",
    title: "Ferry tickets",
    totalMinor: 180_000,
    currency: "INR",
    previousTotalMinor: null,
    otherGroupId: null,
    otherGroupName: null,
    myEffectMinor: -45_000,
    viaDelegation: null,
    viaAssistant: null,
  };

  it("says what, short", () => {
    expect(activityWhat(base)).toBe("Ferry tickets");
    expect(activityWhat({ ...base, action: "edited" })).toBe("Edited Ferry tickets");
    expect(activityWhat({ ...base, action: "deleted" })).toBe("Deleted Ferry tickets");
    expect(activityWhat({ ...base, action: "cookpool" })).toBe("Ferry tickets");
    expect(activityWhat({ ...base, action: "settled", myEffectMinor: -50_000 })).toBe("Paid you");
    expect(activityWhat({ ...base, action: "settled", myEffectMinor: 50_000 })).toBe("You paid");
  });

  it("signs what it did to you; a payment or no change shows its total plain", () => {
    expect(activityAmount(base)).toEqual({ text: "−₹450", tone: "owe" });
    expect(activityAmount({ ...base, myEffectMinor: 120_000 })).toEqual({ text: "+₹1,200", tone: "get" });
    expect(activityAmount({ ...base, action: "settled", totalMinor: 50_000, myEffectMinor: -50_000 })).toEqual({ text: "₹500", tone: "even" });
    expect(activityAmount({ ...base, myEffectMinor: 0 })).toEqual({ text: "₹1,800", tone: "even" });
  });

  it("names the assistant, · Claude", () => {
    expect(viaName(base)).toBeNull();
    expect(viaName({ ...base, viaDelegation: "dlg_1", viaAssistant: "Claude" })).toBe("Claude");
    expect(viaName({ ...base, viaDelegation: "dlg_1", viaAssistant: null })).toBe("Assistant");
  });

  it("groups by Today, Yesterday, then the date (with the year when not this one)", () => {
    const now = new Date(2026, 10, 13, 18, 0);
    const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();
    expect(dayLabel(at(2026, 10, 13, 0), now)).toBe("Today");
    expect(dayLabel(at(2026, 10, 12, 23), now)).toBe("Yesterday");
    expect(dayLabel(at(2026, 10, 8), now)).toBe("8 November");
    expect(dayLabel(at(2025, 11, 31), now)).toBe("31 December 2025");
    const rows = [at(2026, 10, 13, 9), at(2026, 10, 13, 8), at(2026, 10, 12), at(2026, 10, 1)].map((a, i) => ({ at: a, i }));
    expect(byDay(rows, now).map(([d, r]) => [d, r.map((x) => x.i)])).toEqual([
      ["Today", [0, 1]],
      ["Yesterday", [2]],
      ["1 November", [3]],
    ]);
  });
});

describe("the surface, from the source", () => {
  const surface = read("components/tab-surface.tsx");

  it("every tab route renders the one surface on its own tab", () => {
    expect(read("app/page.tsx")).toContain("<TabSurface tab={0} />");
    expect(read("app/groups/page.tsx")).toContain("<TabSurface tab={1} />");
    expect(read("app/activity/page.tsx")).toContain("<TabSurface tab={2} />");
  });

  it("pages with the pager, the pill follows it, taps turn it, the address follows", () => {
    expect(surface).toContain("usePager({ index, count: PAGER_TABS, onChange: setIndex })");
    expect(surface).toContain("<TabBar position={pager.position} dragging={pager.dragging} onTab={setIndex} />");
    expect(surface).toContain('window.history.replaceState(null, "", want)');
    expect(read("components/ui.tsx")).toContain("onTab(i);");
  });

  it("pulls to refresh with an Up to date toast, and remind waits for Undo", () => {
    expect(surface).toContain("usePull(");
    expect(surface).toContain('show({ text: "Up to date" })');
    expect(surface).toContain("sends.schedule(id");
    expect(surface).toContain("sends.undo(id)");
    expect(readGesture("react/pull.ts")).toContain("pullRule(target, surface");
  });

  it("Home: no sentences, three people with Settle / Remind swipe and the hold sheet, three tiles", () => {
    const home = read("components/tabs/home-tab.tsx");
    for (const gone of ["Overall, you owe", "owes you", "friendWhere"]) expect(home).not.toContain(gone);
    expect(home).toContain("<SwipeRow");
    expect(home).toContain('actionTone={action === "settle" ? "cobalt" : "gold"}');
    expect(home).toContain("onHold={() => onHold(p)}");
    expect(home).toContain("<Sheet label={name}");
    for (const tile of ["Scan", "Live", "Insights", "Settle", "Remind", "Open", "See all"]) expect(home).toContain(tile);
  });

  it("Groups and Activity are one line per row: no plan sentences, no explanations", () => {
    const groups = read("components/tabs/groups-tab.tsx");
    expect(groups).not.toContain("planLines");
    expect(groups).not.toContain("Every Cookpool kitchen you");
    expect(groups).toContain('className="seg compact"');
    const activity = read("components/tabs/activity-tab.tsx");
    expect(activity).toContain("byDay(data.entries)");
    expect(activity).toContain("· {via}");
  });

  it("sheets draw on the body, so the moving pager never carries them", () => {
    expect(read("components/ui.tsx")).toContain('createPortal(sheet, document.querySelector<HTMLElement>("[data-spliteco-portal]") ?? document.body)');
  });
});
