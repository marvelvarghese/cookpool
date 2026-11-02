/**
 * Cookpool's one way of saying when (CP-23): every timestamp and date in the
 * app reads the same — "today", "yesterday", "tomorrow", then "28 Oct", with
 * the year only when it isn't this year's ("28 Oct 2025"); very recent
 * moments as "Just now", "5 min ago", "3 h ago"; a time of day as "8:10 pm".
 * Always British day-month order (the canvas's), never the browser's locale.
 *
 * Timestamps (`2026-11-02T08:10:00Z`) are placed in the viewer's own calendar;
 * calendar dates (`2026-11-04`, a use-by or bought-on date) are UTC days, as
 * the server counts them (`daysToUseBy`, risks CP-P), so a date never shifts
 * by a time zone. Pure and dependency-free, so it is unit-testable.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "28 Oct", or "28 Oct 2025" when `withYear`; a UTC calendar day. */
function dayMonthOf(year: number, monthIndex: number, day: number, withYear: boolean): string {
  const d = new Date(Date.UTC(year, monthIndex, day));
  return d.toLocaleDateString(
    "en-GB",
    withYear ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" },
  );
}

/** "today" (0), "yesterday" (−1), "tomorrow" (1), else null. */
function dayWord(offset: number): string | null {
  if (offset === 0) return "today";
  if (offset === -1) return "yesterday";
  if (offset === 1) return "tomorrow";
  return null;
}

function parse(iso: string): Date | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Whole days from `now`'s day to `at`'s, in the viewer's calendar: 0 today, −1 yesterday, 1 tomorrow. */
export function localDayOffset(at: Date, now: Date): number {
  const a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Rounded: a day across a daylight-saving change is 23 or 25 hours.
  return Math.round((a - b) / DAY);
}

/** The first letter in capitals: "Yesterday" to start a line, "yesterday" inside one. */
export function capitalFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** A moment's day: "today", "yesterday", "tomorrow", "28 Oct", "28 Oct 2025". Empty for a value that isn't a date. */
export function dayText(iso: string, now: Date): string {
  const at = parse(iso);
  if (!at) return "";
  return (
    dayWord(localDayOffset(at, now)) ??
    dayMonthOf(at.getFullYear(), at.getMonth(), at.getDate(), at.getFullYear() !== now.getFullYear())
  );
}

/** A time of day: "8:10 pm". */
export function timeText(iso: string): string {
  const at = parse(iso);
  if (!at) return "";
  return at.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** A moment with its time: "today, 8:10 pm", "yesterday, 1:05 pm", "28 Oct, 7:30 pm". */
export function dayAndTimeText(iso: string, now: Date): string {
  const day = dayText(iso, now);
  return day ? `${day}, ${timeText(iso)}` : "";
}

/**
 * How long ago, briefly, to start a line: "Just now", "5 min ago", "3 h ago"
 * (earlier today), then "Yesterday", "28 Oct", "28 Oct 2025".
 */
export function agoText(iso: string, now: Date): string {
  const at = parse(iso);
  if (!at) return "";
  const ms = now.getTime() - at.getTime();
  if (ms < MINUTE) return "Just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (localDayOffset(at, now) === 0) return `${Math.floor(ms / HOUR)} h ago`;
  return capitalFirst(dayText(iso, now));
}

/** A calendar date (YYYY-MM-DD) as "4 Nov", never with a year: use-by chips, "Bought on". */
export function dayMonthText(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return dayMonthOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]), false);
}

/**
 * A calendar date from how many days away it is (the server's `daysToUseBy`):
 * "today", "tomorrow", "yesterday", else "4 Nov".
 */
export function calendarDayText(isoDate: string, daysFromToday: number): string {
  return dayWord(daysFromToday) ?? dayMonthText(isoDate);
}
