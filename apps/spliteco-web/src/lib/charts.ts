// The Insights charts as numbers: donut arcs and bar heights. Pure.

export const CHART_COLORS = ["#FFC857", "#60A5FA", "#5EEAD4", "#4CC98A", "#F29BB7", "#D3A6FF", "#FFB38A", "#A8B6CA"] as const;

export interface DonutSegment {
  /** stroke-dasharray for a circle of circumference C. */
  dash: string;
  /** stroke-dashoffset. */
  offset: number;
  share: number;
}

/**
 * Arcs of a donut whose circle has circumference `circumference`: each value
 * gets its share of it, less a small gap; zeros get nothing.
 */
export function donutSegments(values: readonly number[], circumference: number, gap = 4): DonutSegment[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  let start = 0;
  return values.map((v) => {
    const share = total > 0 ? Math.max(0, v) / total : 0;
    const len = circumference * share;
    const visible = Math.max(0, len - (values.filter((x) => x > 0).length > 1 ? gap : 0));
    const seg = { dash: `${visible} ${circumference - visible}`, offset: -start, share };
    start += len;
    return seg;
  });
}

/** Whole-percent labels that add up to 100 (largest remainder). */
export function percentLabels(values: readonly number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total === 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) * 100) / total);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, r: r - Math.floor(r) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (values[i]! > 0) {
      floors[i]! += 1;
      left -= 1;
    }
  }
  return floors;
}

/** Bar heights in px, the largest at `max`. */
export function barHeights(values: readonly number[], max: number): number[] {
  const top = Math.max(0, ...values);
  return values.map((v) => (top > 0 ? Math.round((Math.max(0, v) / top) * max) : 0));
}

/** "12.5k" / "640" for a bar's label, from minor units. */
export function compactAmount(minor: number): string {
  const major = minor / 100;
  if (major >= 1000) return `${(major / 1000).toFixed(1)}k`;
  return String(Math.round(major));
}

/** YYYY-MM for a date, and the month before. */
export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** +44% against last month, or null when there is nothing to compare with. */
export function changePct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) * 100) / before);
}
