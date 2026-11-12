import {
  canRemind,
  checkAmount,
  ctaText,
  initialSettle,
  kitchenFirst,
  lastRemindedText,
  payOptions,
  reminderPreview,
  settleStep,
  upiAmount,
  upiLink,
  upiUnavailable,
  type SettleEvent,
  type SettleState,
} from "@/lib/settle";

// Settle up in the app (SE2): the UPI deep link, All / Part of it, Kitchen
// first, the steps of the screen — a UPI payment is recorded only after
// "I paid" — and the reminder's preview and "last reminded".

describe("the UPI link", () => {
  it("is upi://pay with the payee's UPI ID, their name, the amount, INR and a note", () => {
    expect(upiLink({ vpa: "devk@okaxis", name: "Dev", amountMinor: 620_00, note: "Goa Trip" })).toBe(
      "upi://pay?pa=devk%40okaxis&pn=Dev&am=620.00&cu=INR&tn=Goa%20Trip",
    );
    expect(upiLink({ vpa: "98100.12345@ybl", name: "Meera R", amountMinor: 5, note: "Flat 4B · Wi-Fi" })).toBe(
      "upi://pay?pa=98100.12345%40ybl&pn=Meera%20R&am=0.05&cu=INR&tn=Flat%204B%20%C2%B7%20Wi-Fi",
    );
    const url = new URL(upiLink({ vpa: "devk@okaxis", name: "Dev", amountMinor: 1234_56, note: "Trip & more?=" })!);
    expect(url.protocol).toBe("upi:");
    expect(Object.fromEntries(url.searchParams)).toEqual({ pa: "devk@okaxis", pn: "Dev", am: "1234.56", cu: "INR", tn: "Trip & more?=" });
  });

  it("keeps the name and note to one short line", () => {
    const url = new URL(upiLink({ vpa: "devk@okaxis", name: "Dev\nKumar", amountMinor: 100, note: `${"x".repeat(80)}\r\n` })!);
    expect(url.searchParams.get("pn")).toBe("Dev Kumar");
    expect(url.searchParams.get("tn")).toHaveLength(50);
  });

  it("is not offered without a UPI ID, for nothing, or outside rupees", () => {
    expect(upiLink({ vpa: null, name: "Dev", amountMinor: 100, note: "x" })).toBeNull();
    expect(upiLink({ vpa: "not-a-vpa", name: "Dev", amountMinor: 100, note: "x" })).toBeNull();
    expect(upiLink({ vpa: "devk@okaxis", name: "Dev", amountMinor: 0, note: "x" })).toBeNull();
    expect(upiLink({ vpa: "devk@okaxis", name: "Dev", amountMinor: 100, note: "x", currency: "USD" })).toBeNull();
    expect(upiUnavailable({ vpa: null, name: "Dev", currency: "INR" })).toMatch(/Dev hasn't added a UPI ID/);
    expect(upiUnavailable({ vpa: "devk@okaxis", name: "Dev", currency: "EUR" })).toBe("UPI pays in rupees only");
    expect(upiUnavailable({ vpa: "devk@okaxis", name: "Dev", currency: "INR" })).toBeNull();
    expect(upiAmount(100_00)).toBe("100.00");
  });
});

describe("how much", () => {
  const plan = { mine: [{ toSubjectId: "usr_dev", owed: { kitchen: 0, other: 620_00 } }, { toSubjectId: "usr_anu", owed: { kitchen: 860_00, other: 4000_00 } }, { toSubjectId: "usr_x", owed: { kitchen: 0, other: 0 } }] };

  it("lists who you pay, largest first", () => {
    expect(payOptions(plan).map((o) => [o.toSubjectId, o.totalMinor])).toEqual([
      ["usr_anu", 4860_00],
      ["usr_dev", 620_00],
    ]);
  });

  it("All pays what is owed; Part of it must be above zero and no more", () => {
    expect(checkAmount("all", null, 620_00, "INR")).toEqual({ ok: true, amountMinor: 620_00 });
    expect(checkAmount("part", 300_00, 620_00, "INR")).toEqual({ ok: true, amountMinor: 300_00 });
    expect(checkAmount("part", 620_01, 620_00, "INR")).toEqual({ ok: false, message: "That's more than you owe (₹620.00)" });
    expect(checkAmount("part", 0, 620_00, "INR")).toMatchObject({ ok: false });
    expect(checkAmount("part", null, 620_00, "INR")).toMatchObject({ ok: false });
  });

  it("fills Kitchen first, then Other", () => {
    expect(kitchenFirst(1000_00, { kitchen: 860_00, other: 4000_00 })).toEqual({ kitchen: 860_00, other: 140_00 });
    expect(kitchenFirst(500_00, { kitchen: 860_00, other: 4000_00 })).toEqual({ kitchen: 500_00, other: 0 });
    expect(kitchenFirst(500_00, { kitchen: 0, other: 4000_00 })).toEqual({ kitchen: 0, other: 500_00 });
  });
});

describe("the Settle up screen's steps", () => {
  function run(events: SettleEvent[], start: SettleState = initialSettle()) {
    let state = start;
    const effects: string[] = [];
    for (const e of events) {
      const next = settleStep(state, e);
      state = next.state;
      if (next.effect) effects.push(next.effect);
    }
    return { state, effects };
  }

  it("UPI: opening the app records nothing; back in the app, “I paid” records it", () => {
    const opened = run([{ type: "go" }]);
    expect(opened).toEqual({ state: { method: "upi", step: "confirm", error: null }, effects: ["open_upi"] });
    expect(run([{ type: "go" }, { type: "paid" }]).effects).toEqual(["open_upi", "record"]);
    expect(run([{ type: "go" }, { type: "paid" }, { type: "saved" }]).state.step).toBe("done");
  });

  it("UPI: “It didn't” goes back without recording", () => {
    const r = run([{ type: "go" }, { type: "didnt" }]);
    expect(r).toEqual({ state: { method: "upi", step: "pick", error: null }, effects: ["open_upi"] });
  });

  it("cash and bank record in one tap", () => {
    expect(run([{ type: "pick", method: "cash" }, { type: "go" }]).effects).toEqual(["record"]);
    expect(run([{ type: "pick", method: "bank" }, { type: "go" }]).state.step).toBe("saving");
  });

  it("a press while saving does nothing, and a failure returns to where it was pressed with the reason", () => {
    const saving = run([{ type: "pick", method: "cash" }, { type: "go" }]).state;
    expect(run([{ type: "go" }, { type: "pick", method: "upi" }], saving)).toEqual({ state: saving, effects: [] });
    expect(run([{ type: "failed", message: "That's more than you owe them here." }], saving).state).toEqual({
      method: "cash",
      step: "pick",
      error: "That's more than you owe them here.",
    });
    const upiSaving = run([{ type: "go" }, { type: "paid" }]).state;
    expect(run([{ type: "failed", message: "x" }], upiSaving).state.step).toBe("confirm");
    // "I paid" only means something after the UPI app was opened.
    expect(run([{ type: "paid" }]).effects).toEqual([]);
  });

  it("says what the button does", () => {
    expect(ctaText("upi", 620_00, "Dev", "INR")).toBe("Open UPI app · ₹620");
    expect(ctaText("cash", 300_50, "Dev", "INR")).toBe("Record ₹300.50 paid to Dev");
  });
});

describe("reminders", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");

  it("previews the message", () => {
    expect(reminderPreview({ toName: "Meera", amountMinor: 2410_00, currency: "INR", groupName: "Goa Trip" })).toBe(
      "Hi Meera — a friendly nudge: ₹2,410 for Goa Trip. One tap to pay by UPI, cash or bank. No rush.",
    );
    expect(reminderPreview({ toName: "Dev", amountMinor: 50, currency: "INR", groupName: null })).toBe(
      "Hi Dev — a friendly nudge: ₹0.50. One tap to pay by UPI, cash or bank. No rush.",
    );
  });

  it("allows one per 24 hours and says when they were last reminded", () => {
    expect(canRemind(null, now)).toBe(true);
    expect(canRemind("2026-11-11T12:30:00.000Z", now)).toBe(false);
    expect(canRemind("2026-11-11T12:00:00.000Z", now)).toBe(true);
    expect(lastRemindedText(null, now)).toBe("Not reminded yet");
    expect(lastRemindedText("2026-11-12T09:00:00.000Z", now)).toBe("Last reminded 3 h ago · next nudge in 21 h");
    expect(lastRemindedText("2026-11-10T12:00:00.000Z", now)).toBe("Last reminded 2 days ago · next nudge allowed now");
    expect(lastRemindedText("2026-11-12T11:59:40.000Z", now)).toBe("Last reminded just now · next nudge in 24 h");
  });
});
