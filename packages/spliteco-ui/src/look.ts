// Money-native MY-2: one look, two themes. The Theme_Tokens board holds the
// token set; a page reads colours as `look.<token>` (a CSS variable) and holds
// none of its own. A LookScope sets the variables for everything inside it.
// "cookpool" is Cookpool's cream and herb green; "spliteco" is Deep ocean,
// built from SPLITECO_INSIDE so it cannot drift from the existing Money tab.

import * as React from "react";
import { SPLITECO_INSIDE as S } from "./inside-look.js";

export const LOOK_TOKENS = [
  "bg", "surface", "ink", "muted", "line", "primary", "onPrimary",
  "soft", "softInk", "get", "owe", "money", "navInk", "grab",
] as const;

export type LookToken = (typeof LOOK_TOKENS)[number];
export type LookTheme = "cookpool" | "spliteco";
export type LookColours = Readonly<Record<LookToken, string>>;

export const LOOK_THEMES: readonly LookTheme[] = ["cookpool", "spliteco"];

export const COOKPOOL_LOOK: LookColours = Object.freeze({
  bg: "#F6F5F0",
  surface: "#FFFFFF",
  ink: "#1B2420",
  muted: "#5E6862",
  line: "#EFEDE6",
  primary: "#1F7A4D",
  onPrimary: "#FFFFFF",
  soft: "#E3EFE7",
  softInk: "#1A6A43",
  get: "#1A6A43",
  owe: "#A3360A",
  money: "#1A6A43",
  navInk: "#1F7A4D",
  grab: "#D8D5CA",
});

/** Deep ocean: the existing inside-look, plus the one new token, grab. */
export const SPLITECO_LOOK: LookColours = Object.freeze({
  bg: S.ground,
  surface: S.card,
  ink: S.ink,
  muted: S.muted,
  line: S.line,
  primary: S.cobalt,
  onPrimary: S.white,
  soft: S.tint,
  softInk: S.soft,
  get: S.get,
  owe: S.owe,
  money: S.gold,
  navInk: S.gold,
  grab: "#33466B",
});

const LOOKS: Record<LookTheme, LookColours> = { cookpool: COOKPOOL_LOOK, spliteco: SPLITECO_LOOK };

/** The colours of a theme (an unknown theme falls back to cookpool). */
export function lookColours(theme: LookTheme): LookColours {
  return LOOKS[theme] ?? COOKPOOL_LOOK;
}

const varName = (token: LookToken) => `--look-${token}`;

/** What a page draws with: `color: look.ink` is `var(--look-ink)`, in any theme. */
export const look: LookColours = Object.freeze(
  Object.fromEntries(LOOK_TOKENS.map((t) => [t, `var(${varName(t)})`])) as Record<LookToken, string>,
);

/** The CSS variables of a theme, as a style object. */
export function lookVars(theme: LookTheme): Record<string, string> {
  const colours = lookColours(theme);
  return Object.fromEntries(LOOK_TOKENS.map((t) => [varName(t), colours[t]]));
}

export interface LookScopeProps {
  theme: LookTheme;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Sets the theme's tokens for everything inside; paints bg and ink as the base. */
export function LookScope({ theme, children, className, style }: LookScopeProps) {
  return React.createElement(
    "div",
    {
      "data-look": theme,
      className,
      style: { ...lookVars(theme), background: look.bg, color: look.ink, ...style } as React.CSSProperties,
    },
    children,
  );
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio of two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
