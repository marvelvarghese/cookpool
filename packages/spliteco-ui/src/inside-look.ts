// Spliteco inside (money-inside MN-2): the one fixed look in this package.
// Every other part takes its colours from the host's theme (theme.tsx); the
// Money tab is Spliteco itself inside Cookpool and Tripeco, so it is drawn in
// Spliteco's Deep ocean whatever the host — and each host's tab bar reads
// these too, so the bar matches while Money is open.

export const SPLITECO_INSIDE = Object.freeze({
  ground: "#0B1426",
  card: "#13203A",
  line: "#1E2C4A",
  tint: "#1A2B4D",
  ink: "#E8EEF8",
  muted: "#94A3B8",
  soft: "#BFD3FF",
  white: "#FFFFFF",
  cobalt: "#2563EB",
  gold: "#F5B53D",
  get: "#2DD4BF",
  owe: "#FB7185",
});
