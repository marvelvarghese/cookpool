/**
 * The floating tab bar's tabs (spliteco-calm SL1, design §1). No React, so
 * which tab is current, where the pill sits and where the + shows are
 * unit-tested.
 */

export const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/groups", label: "Groups", icon: "groups" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/you", label: "You", icon: "you" },
] as const;

/** The pages the sideways pager moves between (SL2): Home, Groups, Activity. You opens by its tab. */
export const PAGER_TABS = 3;

/** Which tab `path` is under; -1 for none. */
export function tabIndexOf(path: string | null | undefined): number {
  if (!path) return -1;
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return 0;
  return TABS.findIndex((t, i) => i > 0 && (p === t.href || p.startsWith(`${t.href}/`)));
}

/** The + floats above the bar on Home, Groups and Activity only: the one main action (design §1). */
export function showsAdd(index: number): boolean {
  return index >= 0 && index < PAGER_TABS;
}

/** Where the pill sits, as a fractional tab index (a swipe passes 0.5 between Home and Groups), kept on the bar. */
export function pillPosition(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(TABS.length - 1, position));
}

/** The tab a fractional position is nearest (it is drawn as current while the finger moves). */
export function nearestTab(position: number): number {
  return Math.round(pillPosition(position));
}
