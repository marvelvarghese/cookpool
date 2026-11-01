/**
 * How the Cookpool app names the people in a group (CP-8). The membership API
 * carries no display names yet (CP-9 adds them), so a person is "You", or a
 * short label made from their public id ("Member · 3f9a"). Every screen names
 * people through `memberLabel`, so CP-9 swaps in real names here, once.
 * Pure and dependency-free, so it is unit-testable.
 */

/** The last four characters of a public id's body: `usr_…c03f9a` → "3f9a". */
export function memberTag(subjectId: string): string {
  const body = subjectId.includes("_") ? subjectId.slice(subjectId.indexOf("_") + 1) : subjectId;
  return (body || subjectId).slice(-4).toLowerCase();
}

/** "You" for the signed-in person, else "Member · 3f9a". */
export function memberLabel(subjectId: string, meId: string | null | undefined): string {
  if (meId && subjectId === meId) return "You";
  return `Member · ${memberTag(subjectId)}`;
}

/** The label inside a sentence, where "You" reads as "you" ("Member · 3f9a pays you"). */
export function memberLabelInline(subjectId: string, meId: string | null | undefined): string {
  return meId && subjectId === meId ? "you" : memberLabel(subjectId, meId);
}

/** Two characters for a person's avatar: "You", else the tag's first two. */
export function memberInitials(subjectId: string, meId: string | null | undefined): string {
  if (meId && subjectId === meId) return "You";
  return memberTag(subjectId).slice(0, 2).toUpperCase();
}

/** You first, then everyone else by label; duplicates dropped. Never mutates the input. */
export function sortMembers(subjectIds: readonly string[], meId: string | null | undefined): string[] {
  const unique = [...new Set(subjectIds)];
  return unique.sort((a, b) => {
    if (meId && a === meId) return -1;
    if (meId && b === meId) return 1;
    return memberLabel(a, meId).localeCompare(memberLabel(b, meId)) || (a < b ? -1 : a > b ? 1 : 0);
  });
}
