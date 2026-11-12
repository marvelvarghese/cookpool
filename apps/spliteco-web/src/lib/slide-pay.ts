/**
 * Settle, slide to pay (spliteco-calm SL5, design §2 "Slide", §3 Settle,
 * canvas V2Settle). The rules the page follows, kept pure so they are tested
 * in node:
 *
 * - how much: All, a custom part, or — in a kitchen group owing on both
 *   balances — Kitchen or Other alone; a custom part still pays Kitchen first
 *   unless the payer types their own Kitchen part (cookpool-spliteco SE2);
 * - what the slider says and when it can move: UPI only after the UPI app was
 *   opened for this very amount (a payment is recorded only on the payer's
 *   own "I paid", here the slide); Cash and Bank at once;
 * - Undo that is real: the slide shows the tick at once and the record call
 *   waits UNDO_MS behind it (`DelayedSends`, as Home's Remind and Group's
 *   Delete); Undo inside the window sends nothing; leaving the page sends what
 *   is waiting; a refusal returns to the slider with the reason.
 */

import { DelayedSends } from "./delayed";
import { formatShort } from "./money";
import { checkAmount, kitchenFirst, type PayMethod } from "./settle";

// ── How much ──────────────────────────────────────────────

export type PayPart = "all" | "kitchen" | "other" | "part";

export interface Owed {
  kitchen: number;
  other: number;
}

/** Kitchen and Other can be paid on their own only in a kitchen group that owes on both. */
export function hasBothBalances(kitchenGroup: boolean, owed: Owed): boolean {
  return kitchenGroup && owed.kitchen > 0 && owed.other > 0;
}

/** The chips under the amount: "All", then "Kitchen ₹860" · "Other ₹4,000" where both are owed, then "Part". */
export function partChips(input: { kitchenGroup: boolean; owed: Owed; currency: string }): { id: PayPart; label: string }[] {
  const chips: { id: PayPart; label: string }[] = [{ id: "all", label: "All" }];
  if (hasBothBalances(input.kitchenGroup, input.owed)) {
    chips.push({ id: "kitchen", label: `Kitchen ${formatShort(input.owed.kitchen, input.currency)}` });
    chips.push({ id: "other", label: `Other ${formatShort(input.owed.other, input.currency)}` });
  }
  chips.push({ id: "part", label: "Part" });
  return chips;
}

export type PayAmount =
  | { ok: true; amountMinor: number; split: Owed | null }
  | { ok: false; message: string };

/**
 * The amount and the split sent with it. `split` null means the server fills
 * Kitchen first, then Other (as before). `ownKitchenMinor` is the payer's own
 * Kitchen part for a custom amount ("Change split"), or null.
 */
export function payAmount(input: {
  part: PayPart;
  owed: Owed;
  partMinor: number | null;
  ownKitchenMinor: number | null;
  kitchenGroup: boolean;
  currency: string;
}): PayAmount {
  const owed = { kitchen: Math.max(0, input.owed.kitchen), other: Math.max(0, input.owed.other) };
  const total = owed.kitchen + owed.other;
  const both = hasBothBalances(input.kitchenGroup, owed);
  if (input.part === "kitchen" && both) return { ok: true, amountMinor: owed.kitchen, split: { kitchen: owed.kitchen, other: 0 } };
  if (input.part === "other" && both) return { ok: true, amountMinor: owed.other, split: { kitchen: 0, other: owed.other } };
  const checked = checkAmount(input.part === "part" ? "part" : "all", input.partMinor, total, input.currency);
  if (!checked.ok) return checked;
  if (input.part !== "part" || !both || input.ownKitchenMinor === null) return { ok: true, amountMinor: checked.amountMinor, split: null };
  const split = { kitchen: input.ownKitchenMinor, other: checked.amountMinor - input.ownKitchenMinor };
  if (split.kitchen < 0 || split.other < 0 || split.kitchen > owed.kitchen || split.other > owed.other) {
    return {
      ok: false,
      message: `Each part must be within what you owe there (Kitchen ${formatShort(owed.kitchen, input.currency)}, Other ${formatShort(owed.other, input.currency)})`,
    };
  }
  return { ok: true, amountMinor: checked.amountMinor, split };
}

/** What the payment pays on each balance, as shown: the payer's split, else Kitchen first. */
export function allocationShown(amountMinor: number, owed: Owed, split: Owed | null): Owed {
  return split ?? kitchenFirst(amountMinor, owed);
}

// ── The method tiles and the slider ───────────────────────

/** UPI's one-word state on its tile when it can't be used, or null. */
export function upiTileState(upiOff: string | null, currency: string): string | null {
  if (!upiOff) return null;
  return currency !== "INR" ? "INR only" : "No UPI ID";
}

/** The slider's words: UPI is slid once paid in the UPI app; cash and bank record. */
export function slideText(method: PayMethod): string {
  return method === "upi" ? "Slide when paid" : "Slide to record";
}

/** What a screen reader hears on the slider. */
export function slideLabel(method: PayMethod, amountText: string, payee: string): string {
  return method === "upi" ? `Slide when paid: record ${amountText} paid to ${payee} by UPI` : `Slide to record ${amountText} paid to ${payee}`;
}

/**
 * Can the slider move? Not without a valid amount, and for UPI not until the
 * UPI app was opened with this very link (a changed amount needs the app again).
 */
export function slideEnabled(input: { method: PayMethod; amountOk: boolean; link: string | null; openedLink: string | null }): boolean {
  if (!input.amountOk) return false;
  if (input.method !== "upi") return true;
  return input.link !== null && input.openedLink === input.link;
}

// ── Slide, then Undo for UNDO_MS, then record ─────────────

/** slide: the slider; held: the tick and Undo, nothing sent yet; sending: the call is out; paid: recorded. */
export type SlidePhase = "slide" | "held" | "sending" | "paid";

export class SlidePay {
  private phase: SlidePhase = "slide";
  private static readonly KEY = "payment";

  constructor(
    private readonly on: {
      change: (phase: SlidePhase) => void;
      failed: (err: unknown) => void;
    },
    private readonly sends: DelayedSends = new DelayedSends(),
  ) {}

  get current(): SlidePhase {
    return this.phase;
  }

  private set(phase: SlidePhase): void {
    this.phase = phase;
    this.on.change(phase);
  }

  /** The slide went past 85% (or Enter): show the tick and hold `record` behind Undo. False unless at the slider. */
  slide(record: () => Promise<unknown>): boolean {
    if (this.phase !== "slide") return false;
    this.set("held");
    this.sends.schedule(SlidePay.KEY, () => {
      this.set("sending");
      record().then(
        () => this.set("paid"),
        (err: unknown) => {
          this.set("slide");
          this.on.failed(err);
        },
      );
    });
    return true;
  }

  /** Undo inside the window: nothing is sent and the slider comes back. False once it has gone. */
  undo(): boolean {
    if (this.phase !== "held" || !this.sends.undo(SlidePay.KEY)) return false;
    this.set("slide");
    return true;
  }

  /** The page is going away: send what is waiting now. */
  flush(): void {
    this.sends.flush();
  }
}
