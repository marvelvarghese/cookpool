import { TOAST_ABOVE_ATTR, TOAST_GAP, toastLift } from "@web-console-next/lib/toast-lift";

// A 390×844 phone, as the audit measured it: the toast viewport's CSS place is
// 72px up (above the tab bar) with 16px of padding, so a toast's lower edge
// sits at 844 − 72 − 16 = 756.
const PHONE = { viewportHeight: 844, baseBottom: 72, padding: 16, toastHeight: 78 };
const TAB_BAR = { top: 780, bottom: 844 };
// A screen's main button held above the tab bar (Use, the item page, Bought, Cook): 692–752.
const MAIN = { top: 692, bottom: 752 };

describe("toasts never cover the main button (SM-15, the audit's item 14)", () => {
  it("is marked on the bars that hold a main button", () => {
    expect(TOAST_ABOVE_ATTR).toBe("data-toast-above");
    expect(TOAST_GAP).toBe(8);
  });

  it("leaves the toast where it is above the tab bar when nothing else is held there", () => {
    expect(toastLift({ ...PHONE, obstacles: [TAB_BAR] })).toBeNull();
    expect(toastLift({ ...PHONE, obstacles: [] })).toBeNull();
  });

  it("lifts it over a sticky main button, with a gap", () => {
    // Before SM-15 the toast's 678–756 covered the dish's Finalize (692–752) and Cook's button.
    const bottom = toastLift({ ...PHONE, obstacles: [TAB_BAR, MAIN] });
    expect(bottom).toBe(844 - (692 - TOAST_GAP) - 16);
    const lowerEdge = 844 - bottom! - PHONE.padding;
    expect(lowerEdge).toBeLessThanOrEqual(MAIN.top - TOAST_GAP);
  });

  it("clears a bar that carries more than the button (the dish's money line rides with Finalize)", () => {
    const bar = { top: 610, bottom: 760 };
    const bottom = toastLift({ ...PHONE, obstacles: [bar, TAB_BAR] });
    expect(844 - bottom! - 16).toBe(610 - TOAST_GAP);
  });

  it("does not jump over a button further up the page, out of the toast's way", () => {
    // The item page's Use some sits in the flow at 420–480 when the page is short.
    expect(toastLift({ ...PHONE, obstacles: [{ top: 420, bottom: 480 }, TAB_BAR] })).toBeNull();
  });

  it("keeps climbing while the next bar up is in the way", () => {
    const stacked = [MAIN, { top: 600, bottom: 690 }];
    const bottom = toastLift({ ...PHONE, obstacles: stacked });
    expect(844 - bottom! - 16).toBe(600 - TOAST_GAP);
  });

  it("ignores bars that are off screen or have no size (the tab bar is hidden from 900px)", () => {
    expect(toastLift({ ...PHONE, obstacles: [{ top: 900, bottom: 960 }, { top: 0, bottom: 0 }] })).toBeNull();
  });

  it("works with the desktop place too: bottom 16px, a held bar at the foot", () => {
    const desk = { viewportHeight: 800, baseBottom: 16, padding: 16, toastHeight: 64 };
    expect(toastLift({ ...desk, obstacles: [] })).toBeNull();
    expect(toastLift({ ...desk, obstacles: [{ top: 700, bottom: 776 }] })).toBe(800 - (700 - TOAST_GAP) - 16);
  });
});
