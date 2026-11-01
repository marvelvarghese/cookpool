/**
 * How the Cookpool app names the people in a group (CP-8; real names since
 * CP-9). A person is "You", their display name when the app knows it — from
 * `myBalances().people` (everyone you share a group with) or a group's member
 * list — else a short label made from their public id ("Member · 3f9a").
 * Every screen names people through `memberLabel`, passing the names it has.
 * Pure and dependency-free, so it is unit-testable.
 */

/** Display names by subject id; a missing or empty name falls back to the id's tag. */
export type MemberNames = ReadonlyMap<string, string | null | undefined>;

/** The last four characters of a public id's body: `usr_…c03f9a` → "3f9a". */
export function memberTag(subjectId: string): string {
  const body = subjectId.includes("_") ? subjectId.slice(subjectId.indexOf("_") + 1) : subjectId;
  return (body || subjectId).slice(-4).toLowerCase();
}

/** The person's display name, trimmed; null when there is none. */
export function memberName(subjectId: string, names?: MemberNames | null): string | null {
  const name = names?.get(subjectId)?.trim();
  return name ? name : null;
}

/** "You" for the signed-in person, else their name, else "Member · 3f9a". */
export function memberLabel(subjectId: string, meId: string | null | undefined, names?: MemberNames | null): string {
  if (meId && subjectId === meId) return "You";
  return memberName(subjectId, names) ?? `Member · ${memberTag(subjectId)}`;
}

/** The label inside a sentence, where "You" reads as "you" ("Anu pays you"). */
export function memberLabelInline(subjectId: string, meId: string | null | undefined, names?: MemberNames | null): string {
  return meId && subjectId === meId ? "you" : memberLabel(subjectId, meId, names);
}

/**
 * A name's initials for an avatar: the first letters of its first two words
 * ("Rahul Varghese" → "RV", "dev.patel" → "DP"), or one letter for a single
 * word ("Anu" → "A").
 */
export function nameInitials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0]!;
  if (words.length === 1) return first.toUpperCase();
  return (first + [...words[1]!][0]!).toUpperCase();
}

/** What a person's avatar shows: "You", their name's initials, else the id tag's first two. */
export function memberInitials(subjectId: string, meId: string | null | undefined, names?: MemberNames | null): string {
  if (meId && subjectId === meId) return "You";
  const name = memberName(subjectId, names);
  return name ? nameInitials(name) : memberTag(subjectId).slice(0, 2).toUpperCase();
}

/** You first, then everyone else by label; duplicates dropped. Never mutates the input. */
export function sortMembers(subjectIds: readonly string[], meId: string | null | undefined, names?: MemberNames | null): string[] {
  const unique = [...new Set(subjectIds)];
  return unique.sort((a, b) => {
    if (meId && a === meId) return -1;
    if (meId && b === meId) return 1;
    return memberLabel(a, meId, names).localeCompare(memberLabel(b, meId, names)) || (a < b ? -1 : a > b ? 1 : 0);
  });
}
