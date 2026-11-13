// Faces: an initial on a tint, the same tint for the same person everywhere.

const TINTS = [
  { bg: "#3A2333", fg: "#F29BB7" },
  { bg: "#123A3A", fg: "#5EEAD4" },
  { bg: "#3A3018", fg: "#FFC857" },
  { bg: "#2A2340", fg: "#C4B5FD" },
  { bg: "#3A2A18", fg: "#FDBA74" },
  { bg: "#1E3320", fg: "#86EFAC" },
];
const ME = { bg: "#1C3357", fg: "#93C5FD" };

export function tintOf(subjectId: string, me: string | null): { bg: string; fg: string } {
  if (me && subjectId === me) return ME;
  let h = 0;
  for (const ch of subjectId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0]!.toUpperCase() : "?";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
