// Home · Vehicles · Groups (tripeco TR-5): which tab an address is, and back. Pure.

export const TAB_PATHS = ["/", "/vehicles", "/groups"] as const;

export function tabIndexOf(path: string): number {
  const p = path.replace(/\/+$/, "") || "/";
  return TAB_PATHS.indexOf(p as (typeof TAB_PATHS)[number]);
}

export const tabPath = (index: number): string => TAB_PATHS[index] ?? "/";

/** "Airport drop · ₹257" — a need's line. */
export function needLine(title: string, amountMinor: number | null): string {
  return amountMinor === null ? title : `${title} · ₹${Math.round(amountMinor / 100).toLocaleString("en-IN")}`;
}
