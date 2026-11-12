import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DelayedSends, UNDO_MS, type Timers } from "@/lib/delayed";
import {
  SlidePay,
  allocationShown,
  partChips,
  payAmount,
  slideEnabled,
  slideLabel,
  slideText,
  upiTileState,
  type SlidePhase,
} from "@/lib/slide-pay";
import { kitchenFirst, upiLink, upiUnavailable } from "@/lib/settle";

// Settle, slide to pay (spliteco-calm SL5, V2Settle): the slider's words per
// method, the UPI gate, the record held behind a real Undo, partial amounts and
// Kitchen first — the SE2/SE3 rules unchanged.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/spliteco-web");

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

function setup() {
  const c = clock();
  const phases: SlidePhase[] = [];
  const failures: unknown[] = [];
  const pay = new SlidePay({ change: (p) => phases.push(p), failed: (e) => failures.push(e) }, new DelayedSends(c));
  return { c, pay, phases, failures };
}

describe("the slider", () => {
  it("reads Slide when paid for UPI and Slide to record for cash and bank", () => {
    expect(slideText("upi")).toBe("Slide when paid");
    expect(slideText("cash")).toBe("Slide to record");
    expect(slideText("bank")).toBe("Slide to record");
    expect(slideLabel("cash", "₹620", "Dev")).toBe("Slide to record ₹620 paid to Dev");
    expect(slideLabel("upi", "₹620", "Dev")).toMatch(/^Slide when paid/);
  });

  it("UPI: stays off until the UPI app was opened for this very amount", () => {
    const link = upiLink({ vpa: "devk@okaxis", name: "Dev", amountMinor: 620_00, note: "Goa" });
    const other = upiLink({ vpa: "devk@okaxis", name: "Dev", amountMinor: 300_00, note: "Goa" });
    expect(slideEnabled({ method: "upi", amountOk: true, link, openedLink: null })).toBe(false);
    expect(slideEnabled({ method: "upi", amountOk: true, link, openedLink: link })).toBe(true);
    // Changed the amount after opening the app: open it again first.
    expect(slideEnabled({ method: "upi", amountOk: true, link: other, openedLink: link })).toBe(false);
    expect(slideEnabled({ method: "upi", amountOk: true, link: null, openedLink: null })).toBe(false);
    expect(slideEnabled({ method: "upi", amountOk: false, link, openedLink: link })).toBe(false);
  });

  it("cash and bank slide at once, given a valid amount", () => {
    expect(slideEnabled({ method: "cash", amountOk: true, link: null, openedLink: null })).toBe(true);
    expect(slideEnabled({ method: "bank", amountOk: true, link: null, openedLink: null })).toBe(true);
    expect(slideEnabled({ method: "cash", amountOk: false, link: null, openedLink: null })).toBe(false);
  });

  it("UPI's tile says why in one short state when it can't be used", () => {
    expect(upiTileState(upiUnavailable({ vpa: null, name: "Dev", currency: "INR" }), "INR")).toBe("No UPI ID");
    expect(upiTileState(upiUnavailable({ vpa: "devk@okaxis", name: "Dev", currency: "EUR" }), "EUR")).toBe("INR only");
    expect(upiTileState(null, "INR")).toBeNull();
  });
});

describe("slide, Undo, then record", () => {
  it("shows the tick at once and records only after UNDO_MS", async () => {
    const { c, pay, phases } = setup();
    let calls = 0;
    expect(pay.slide(() => (calls++, Promise.resolve()))).toBe(true);
    expect(pay.current).toBe("held");
    c.advance(UNDO_MS - 1);
    expect(calls).toBe(0);
    c.advance(1);
    expect(calls).toBe(1);
    expect(pay.current).toBe("sending");
    await flushPromises();
    expect(phases).toEqual(["held", "sending", "paid"]);
  });

  it("Undo inside the window sends nothing and brings the slider back", () => {
    const { c, pay, phases } = setup();
    let calls = 0;
    pay.slide(() => (calls++, Promise.resolve()));
    expect(pay.undo()).toBe(true);
    c.advance(UNDO_MS * 2);
    expect(calls).toBe(0);
    expect(phases).toEqual(["held", "slide"]);
    // Once it has gone, Undo is too late.
    pay.slide(() => (calls++, Promise.resolve()));
    c.advance(UNDO_MS);
    expect(pay.undo()).toBe(false);
    expect(calls).toBe(1);
  });

  it("a second slide while one waits is ignored", () => {
    const { c, pay } = setup();
    let calls = 0;
    pay.slide(() => (calls++, Promise.resolve()));
    expect(pay.slide(() => (calls++, Promise.resolve()))).toBe(false);
    c.advance(UNDO_MS);
    expect(calls).toBe(1);
  });

  it("leaving the page sends what is waiting", () => {
    const { pay } = setup();
    let calls = 0;
    pay.slide(() => (calls++, Promise.resolve()));
    pay.flush();
    expect(calls).toBe(1);
  });

  it("a refusal returns to the slider with the reason", async () => {
    const { c, pay, phases, failures } = setup();
    pay.slide(() => Promise.reject(new Error("over_owed")));
    c.advance(UNDO_MS);
    await flushPromises();
    expect(phases).toEqual(["held", "sending", "slide"]);
    expect(String(failures[0])).toContain("over_owed");
    // And it can be slid again.
    expect(pay.slide(() => Promise.resolve())).toBe(true);
  });
});

describe("how much", () => {
  const both = { kitchen: 860_00, other: 4000_00 };

  it("offers All and Part, and Kitchen / Other only where a kitchen group owes on both", () => {
    expect(partChips({ kitchenGroup: false, owed: { kitchen: 0, other: 620_00 }, currency: "INR" }).map((c) => c.label)).toEqual(["All", "Part"]);
    expect(partChips({ kitchenGroup: true, owed: both, currency: "INR" }).map((c) => c.label)).toEqual(["All", "Kitchen ₹860", "Other ₹4,000", "Part"]);
    expect(partChips({ kitchenGroup: true, owed: { kitchen: 0, other: 100_00 }, currency: "INR" }).map((c) => c.id)).toEqual(["all", "part"]);
  });

  it("All pays everything; the server fills Kitchen first", () => {
    expect(payAmount({ part: "all", owed: both, partMinor: null, ownKitchenMinor: null, kitchenGroup: true, currency: "INR" })).toEqual({ ok: true, amountMinor: 4860_00, split: null });
  });

  it("a part must be above zero and no more than owed", () => {
    const base = { part: "part" as const, owed: { kitchen: 0, other: 620_00 }, ownKitchenMinor: null, kitchenGroup: false, currency: "INR" };
    expect(payAmount({ ...base, partMinor: 300_00 })).toEqual({ ok: true, amountMinor: 300_00, split: null });
    expect(payAmount({ ...base, partMinor: 620_01 })).toEqual({ ok: false, message: "That's more than you owe (₹620.00)" });
    expect(payAmount({ ...base, partMinor: 0 })).toMatchObject({ ok: false });
    expect(payAmount({ ...base, partMinor: null })).toMatchObject({ ok: false });
  });

  it("a part pays Kitchen first unless the payer changes the split", () => {
    const base = { part: "part" as const, owed: both, partMinor: 1000_00, kitchenGroup: true, currency: "INR" };
    const auto = payAmount({ ...base, ownKitchenMinor: null });
    expect(auto).toEqual({ ok: true, amountMinor: 1000_00, split: null });
    expect(allocationShown(1000_00, both, null)).toEqual({ kitchen: 860_00, other: 140_00 });
    expect(allocationShown(1000_00, both, null)).toEqual(kitchenFirst(1000_00, both));
    expect(payAmount({ ...base, ownKitchenMinor: 200_00 })).toEqual({ ok: true, amountMinor: 1000_00, split: { kitchen: 200_00, other: 800_00 } });
    expect(payAmount({ ...base, ownKitchenMinor: 900_00 })).toMatchObject({ ok: false });
    expect(payAmount({ ...base, ownKitchenMinor: 1200_00 })).toMatchObject({ ok: false });
  });

  it("Kitchen or Other alone pays that balance only", () => {
    const base = { owed: both, partMinor: null, ownKitchenMinor: null, kitchenGroup: true, currency: "INR" };
    expect(payAmount({ ...base, part: "kitchen" })).toEqual({ ok: true, amountMinor: 860_00, split: { kitchen: 860_00, other: 0 } });
    expect(payAmount({ ...base, part: "other" })).toEqual({ ok: true, amountMinor: 4000_00, split: { kitchen: 0, other: 4000_00 } });
  });
});

describe("the Settle page", () => {
  const page = readFileSync(`${app}/src/app/settle/page.tsx`, "utf8");

  it("records by the slider, behind SlidePay's Undo, flushing on leave", () => {
    expect(page).toContain("<Slider");
    expect(page).toContain("new SlidePay(");
    expect(page).toContain('addEventListener("pagehide"');
    expect(page).toContain("pay.undo()");
    expect(page).toContain("client.spliteco.settle(");
  });

  it("opens the UPI app with the upi://pay link before the slider can move", () => {
    expect(page).toContain("setOpenedLink(link)");
    expect(page).toContain("window.location.href = link");
    expect(page).toContain("Open UPI app");
  });
});
