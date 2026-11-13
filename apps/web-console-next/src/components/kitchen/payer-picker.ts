/**
 * Who paid?'s search (cookpool-kitchen-calm KC-6): everyone whose name
 * has the typed words, in the group's order. Pure, so it is unit-testable.
 */
export function payerMatches(roster: readonly string[], query: string, label: (id: string) => string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...roster];
  return roster.filter((id) => label(id).toLowerCase().includes(q));
}
