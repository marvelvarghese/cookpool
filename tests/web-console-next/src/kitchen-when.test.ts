import {
  agoText,
  calendarDayText,
  capitalFirst,
  dayAndTimeText,
  dayMonthText,
  dayText,
  localDayOffset,
  timeText,
} from "@web-console-next/components/kitchen/when";
import { relativeWhen } from "@web-console-next/components/kitchen/activity";
import { dishDay, dishWhen } from "@web-console-next/components/kitchen/dish";
import { dayMonth } from "@web-console-next/components/kitchen/pantry";
import { shortDate } from "@web-console-next/components/kitchen/kit";

const NOW = new Date(2026, 10, 2, 18, 0, 0); // 2 Nov 2026, 18:00 local
const at = (d: Date) => d.toISOString();

describe("when: one way to say a day (CP-23)", () => {
  it("today, yesterday, tomorrow, then the date — with the year only when it isn't this one", () => {
    expect(dayText(at(new Date(2026, 10, 2, 0, 5)), NOW)).toBe("today");
    expect(dayText(at(new Date(2026, 10, 1, 23, 59)), NOW)).toBe("yesterday");
    expect(dayText(at(new Date(2026, 10, 3, 8, 0)), NOW)).toBe("tomorrow");
    expect(dayText(at(new Date(2026, 9, 28, 19, 30)), NOW)).toBe("28 Oct");
    expect(dayText(at(new Date(2025, 9, 28, 19, 30)), NOW)).toBe("28 Oct 2025");
    expect(dayText("not a date", NOW)).toBe("");
  });

  it("counts days in the viewer's calendar", () => {
    expect(localDayOffset(new Date(2026, 10, 2, 23, 59), NOW)).toBe(0);
    expect(localDayOffset(new Date(2026, 9, 31, 0, 1), NOW)).toBe(-2);
    // Across the end of British Summer Time (25 Oct 2026) a day is 25 hours: still one day each.
    expect(localDayOffset(new Date(2026, 9, 24, 12, 0), new Date(2026, 9, 26, 12, 0))).toBe(-2);
  });

  it("a time of day, and a moment with its time", () => {
    expect(timeText(at(new Date(2026, 10, 2, 20, 10)))).toBe("8:10 pm");
    expect(dayAndTimeText(at(new Date(2026, 10, 1, 13, 5)), NOW)).toBe("yesterday, 1:05 pm");
    expect(dayAndTimeText(at(new Date(2026, 9, 28, 19, 30)), NOW)).toBe("28 Oct, 7:30 pm");
    expect(dayAndTimeText("nope", NOW)).toBe("");
  });

  it("how long ago, to start a line", () => {
    expect(agoText(at(new Date(2026, 10, 2, 17, 59, 30)), NOW)).toBe("Just now");
    expect(agoText(at(new Date(2026, 10, 2, 17, 55)), NOW)).toBe("5 min ago");
    expect(agoText(at(new Date(2026, 10, 2, 9, 0)), NOW)).toBe("9 h ago");
    expect(agoText(at(new Date(2026, 10, 1, 21, 0)), NOW)).toBe("Yesterday");
    expect(agoText(at(new Date(2026, 9, 12, 9, 0)), NOW)).toBe("12 Oct");
    expect(agoText(at(new Date(2025, 9, 12, 9, 0)), NOW)).toBe("12 Oct 2025");
  });

  it("calendar dates are UTC days and never shift by a time zone", () => {
    expect(dayMonthText("2026-11-04")).toBe("4 Nov");
    expect(dayMonthText("2026-01-01T00:00:00.000Z")).toBe("1 Jan");
    expect(dayMonthText("someday")).toBe("someday");
    expect(calendarDayText("2026-11-02", 0)).toBe("today");
    expect(calendarDayText("2026-11-03", 1)).toBe("tomorrow");
    expect(calendarDayText("2026-11-01", -1)).toBe("yesterday");
    expect(calendarDayText("2026-11-12", 10)).toBe("12 Nov");
    expect(capitalFirst("yesterday")).toBe("Yesterday");
    expect(capitalFirst("")).toBe("");
  });

  it("every older helper says it the same way, through this one", () => {
    const iso = at(new Date(2026, 9, 28, 19, 30));
    expect(relativeWhen(iso, NOW)).toBe(agoText(iso, NOW));
    expect(dishDay(iso, NOW)).toBe(dayText(iso, NOW));
    expect(dishWhen(iso, NOW)).toBe(dayAndTimeText(iso, NOW));
    expect(dayMonth("2026-11-04")).toBe(dayMonthText("2026-11-04"));
    // "Joined 28 Oct", not the browser's own date format.
    expect(shortDate(iso, NOW)).toBe("28 Oct");
    expect(shortDate(at(new Date(2026, 10, 2, 9, 0)), NOW)).toBe("today");
  });
});
