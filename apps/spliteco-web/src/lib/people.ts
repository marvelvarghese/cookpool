// What people are called and how their faces look. Names come from the
// API's `people` lists; someone with no name shows as "Someone".

import type { SplitecoPerson } from "@saas/contracts/spliteco";

export type Names = Map<string, string | null>;

export function namesFrom(...lists: (readonly SplitecoPerson[] | undefined)[]): Names {
  const out: Names = new Map();
  for (const list of lists) for (const p of list ?? []) if (!out.get(p.subjectId)) out.set(p.subjectId, p.name);
  return out;
}

/** "You" for the caller, the name otherwise. */
export function nameOf(names: Names, subjectId: string, me: string | null): string {
  if (subjectId === me) return "You";
  return names.get(subjectId)?.trim() || "Someone";
}

export function initialOf(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

/** Face colours, picked by the id so a person keeps theirs everywhere. */
const TINTS: readonly { bg: string; fg: string }[] = [
  { bg: "rgba(242,155,183,0.16)", fg: "#F29BB7" },
  { bg: "rgba(94,234,212,0.16)", fg: "#5EEAD4" },
  { bg: "rgba(255,200,87,0.16)", fg: "#FFC857" },
  { bg: "rgba(211,166,255,0.16)", fg: "#D3A6FF" },
  { bg: "rgba(127,216,176,0.16)", fg: "#7FD8B0" },
  { bg: "rgba(255,179,138,0.16)", fg: "#FFB38A" },
];
const ME = { bg: "rgba(96,165,250,0.16)", fg: "#93C5FD" };

export function tintOf(subjectId: string, me: string | null): { bg: string; fg: string } {
  if (subjectId === me) return ME;
  let h = 0;
  for (let i = 0; i < subjectId.length; i++) h = (h * 31 + subjectId.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

/** "You, Anu, Dev and Meera". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
