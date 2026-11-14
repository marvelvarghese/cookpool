"use client";

// Money-native MY-4: the Money page shell and its Groups side (boards
// Settle_Money and Money_Ocean). The shell is the title with one 11px
// "Powered by Spliteco" line and the Groups | People switch; People takes it as
// its `header` slot (see people-ui). Colours are tokens only (`look.*`, set by a
// LookScope from the `theme` prop). The floating Expense button (MY-3, MY-7)
// mounts into the `floatingButton` slot.

import * as React from "react";
import type { SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { BOARD, BOARD_FONT } from "./board.js";
import { LookScope, look, type LookTheme } from "./look.js";
import { pillOffset, sideDirection, transitionOf } from "./motion.js";
import { Amount, useReducedMotion } from "./motion-ui.js";
import {
  moneyTabGroups,
  moneyTotals,
  signedShort,
  toneOf,
} from "./money-tab.js";

const FONT = BOARD_FONT;
const TONE = { get: look.get, owe: look.owe, even: look.muted } as const;
/** The headline amount's colour: the `money` token when you are owed (gold in Deep ocean), owe when you owe. */
const NET_TONE = { get: look.money, owe: look.owe, even: look.muted } as const;
const B = BOARD;

export type MoneySide = "groups" | "people";

export interface MoneyHeaderProps {
  /** The side that is open. */
  side: MoneySide;
  onSide: (side: MoneySide) => void;
  /** Shown only on Groups; opens Add group. */
  onAddGroup?: () => void;
  /** The bell: reminders. */
  onReminders?: () => void;
}

const svgProps = (size: number, stroke: number) =>
  ({
    "aria-hidden": true,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  }) as const;

function Icon({ side }: { side: MoneySide }) {
  const p = svgProps(B.switch.icon, B.switch.stroke);
  return side === "groups" ? (
    <svg {...p}>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </svg>
  ) : (
    <svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </svg>
  );
}

const SIDES: { side: MoneySide; label: string }[] = [
  { side: "groups", label: "Groups" },
  { side: "people", label: "People" },
];

/** The side the switch last showed, so a switch that is mounted anew (each side is its own page) starts where the last one was and slides. */
let lastShownSide: MoneySide | null = null;
/** For tests: forget the remembered side. */
export function resetMoneySwitchMemory(): void {
  lastShownSide = null;
}

/** The Groups | People switch: the open side is a tinted pill that slides to the other side; its label and icon cross-fade. */
export function MoneySwitch({
  side,
  onSide,
  reduceMotion,
}: Pick<MoneyHeaderProps, "side" | "onSide"> & { reduceMotion?: boolean }) {
  const reduced = useReducedMotion(reduceMotion);
  // First paint at the side shown last, then the current one a frame later, so the pill travels.
  const [shown, setShown] = React.useState<MoneySide>(lastShownSide ?? side);
  React.useEffect(() => {
    lastShownSide = side;
    if (shown === side) return;
    if (typeof requestAnimationFrame !== "function") { setShown(side); return; }
    const first = requestAnimationFrame(() => setShown(side));
    return () => cancelAnimationFrame(first);
  }, [side, shown]);
  const travel = B.switch.foldedWidth + B.switch.gap;
  const openWidth = `calc(100% - ${B.switch.foldedWidth + B.switch.gap}px)`;
  const slide = reduced ? transitionOf("fade", ["opacity"], true) : transitionOf("geometry", ["transform"]);
  const widthMove = reduced ? "none" : transitionOf("geometry", ["width"]);
  const fade = transitionOf("fade", ["opacity", "color"], reduced);
  // Which way the pill is going: from where it is to where it is asked to be; once it is there the last way stays.
  const way = React.useRef<1 | -1>(1);
  if (shown !== side) way.current = sideDirection(shown, side);
  const direction = way.current;
  return (
    <div
      role="tablist"
      aria-label="Money"
      data-switch=""
      data-vt-keep="money-switch"
      data-side={shown}
      data-direction={direction > 0 ? "forward" : "back"}
      style={{
        position: "relative",
        display: "flex",
        gap: B.switch.gap,
        height: B.switch.height,
        padding: B.switch.pad,
        borderRadius: B.switch.radius,
        background: look.surface,
        boxSizing: "border-box",
      }}
    >
      <span
        data-switch-pill=""
        aria-hidden="true"
        style={{
          position: "absolute",
          top: B.switch.pad,
          bottom: B.switch.pad,
          left: B.switch.pad,
          width: `calc(100% - ${2 * B.switch.pad + travel}px)`,
          borderRadius: B.switch.tabRadius,
          background: look.soft,
          transform: `translate3d(${pillOffset(shown, travel)}px,0,0)`,
          transition: slide,
          willChange: "transform",
        }}
      />
      {SIDES.map((s) => {
        const open = s.side === side;
        return (
          <button
            key={s.side}
            type="button"
            role="tab"
            aria-selected={open}
            aria-label={s.label}
            data-side={s.side}
            data-open={open ? "true" : "false"}
            onClick={() => onSide(s.side)}
            style={{
              position: "relative",
              flex: "none",
              width: open ? openWidth : B.switch.foldedWidth,
              transition: widthMove,
              padding: 0,
              borderRadius: B.switch.tabRadius,
              border: 0,
              background: "transparent",
              color: open ? look.softInk : look.muted,
              fontSize: B.switch.size,
              fontWeight: B.switch.weight,
              fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <span style={{ display: "flex", transition: fade }}>
              <Icon side={s.side} />
            </span>
            <span
              data-label=""
              aria-hidden={open ? undefined : true}
              style={{
                display: "block",
                whiteSpace: "nowrap",
                overflow: "hidden",
                maxWidth: open ? 120 : 0,
                marginLeft: open ? B.switch.iconGap : 0,
                opacity: open ? 1 : 0,
                transition: reduced ? fade : `${transitionOf("fade", ["opacity"])}, ${transitionOf("geometry", ["max-width", "margin-left"])}`,
              }}
            >
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The title with its one Powered by Spliteco line, + Group (Groups only) and the bell, then the switch. Two siblings: the page's gap spaces them. */
export function MoneyHeader({
  side,
  onSide,
  onAddGroup,
  onReminders,
}: MoneyHeaderProps) {
  return (
    <>
      <header
        data-header=""
        style={{
          display: "flex",
          alignItems: "center",
          height: B.header.height,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: B.header.poweredGap,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: B.header.titleSize,
              fontWeight: B.header.titleWeight,
              letterSpacing: B.header.titleTracking,
              color: look.ink,
            }}
          >
            Money
          </h1>
          <span
            data-powered-by=""
            style={{ fontSize: B.header.poweredSize, color: look.muted }}
          >
            Powered by Spliteco
          </span>
        </div>
        {side === "groups" && onAddGroup ? (
          <button
            type="button"
            data-action="add-group-top"
            aria-label="Add group"
            onClick={onAddGroup}
            style={{
              height: B.addGroup.height,
              padding: `0 ${B.addGroup.padRight}px 0 ${B.addGroup.padLeft}px`,
              marginRight: B.addGroup.marginRight,
              borderRadius: B.addGroup.radius,
              border: 0,
              background: look.soft,
              color: look.softInk,
              fontSize: B.addGroup.size,
              fontWeight: B.addGroup.weight,
              fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
              cursor: "pointer",
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: B.addGroup.gap,
            }}
          >
            <svg
              {...svgProps(B.addGroup.icon, B.addGroup.stroke)}
              strokeLinejoin={undefined}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Group
          </button>
        ) : null}
        <button
          type="button"
          data-action="reminders"
          aria-label="Reminders"
          onClick={onReminders}
          style={{
            width: B.bell.size,
            height: B.bell.size,
            borderRadius: "50%",
            border: 0,
            background: look.surface,
            color: look.ink,
            cursor: "pointer",
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <svg {...svgProps(B.bell.icon, B.bell.stroke)}>
            <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
        </button>
      </header>
      <MoneySwitch side={side} onSide={onSide} />
    </>
  );
}

export interface GroupsPageProps {
  theme: LookTheme;
  groups: readonly SplitecoGroupSummary[];
  /** The switch. People is its own page: render it with `<MoneyHeader side="people" …/>` as its `header`. */
  onSide: (side: MoneySide) => void;
  onOpenGroup: (groupId: string) => void;
  /** + Group at the top and the Add group row at the end. */
  onAddGroup: () => void;
  /** The bell. */
  onReminders?: () => void;
  /** MY-3 / MY-7's floating Expense button. */
  floatingButton?: React.ReactNode;
}

function Net({ groups }: { groups: readonly SplitecoGroupSummary[] }) {
  const totals = moneyTotals(groups);
  return (
    <section
      data-net=""
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: `${B.net.padTop}px ${B.net.padX}px 0`,
      }}
    >
      {totals.map((t) => (
        <div
          key={t.currency}
          data-currency={t.currency}
          style={{ display: "flex", flexDirection: "column", gap: B.net.gap }}
        >
          <span
            data-amount=""
            style={{
              fontSize: B.net.amountSize,
              fontWeight: B.net.amountWeight,
              letterSpacing: "-0.02em",
              color: NET_TONE[toneOf(t.minor)],
            }}
          >
            <Amount value={t.minor} format={(m) => (m === 0 ? "Settled" : signedShort(m, t.currency))} />
          </span>
          <span style={{ fontSize: B.net.wordsSize, color: look.muted }}>
            {t.words}
          </span>
        </div>
      ))}
    </section>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: B.groupRow.gap,
  height: B.groupRow.height,
  padding: `0 ${B.groupRow.padX}px`,
  width: "100%",
  border: 0,
  background: "transparent",
  fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
  textAlign: "left",
  cursor: "pointer",
  boxSizing: "border-box",
};

const initialOf = (name: string): string =>
  Array.from(name.trim())[0]?.toUpperCase() ?? "?";

/** The slot MY-3's floating Expense button mounts into. Empty until then. */
function FloatingSlot({ children }: { children?: React.ReactNode }) {
  return (
    <div
      data-slot="floating-button"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <div style={{ pointerEvents: "auto" }}>{children}</div>
    </div>
  );
}

/** Money, Groups side: the net, a row per group (avatar, name and one balance, Settled when even), and Add group last. */
export function GroupsPage({
  theme,
  groups,
  onSide,
  onOpenGroup,
  onAddGroup,
  onReminders,
  floatingButton,
}: GroupsPageProps) {
  const ordered = moneyTabGroups(groups);
  return (
    <LookScope
      theme={theme}
      style={{
        position: "relative",
        minHeight: "100%",
        fontFamily: FONT,
        lineHeight: "normal",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div
        data-page="groups"
        style={{
          padding: `${B.page.padTop}px ${B.page.padX}px var(--cp-page-end, 120px)`,
          display: "flex",
          flexDirection: "column",
          gap: B.page.gapGroups,
        }}
      >
        <MoneyHeader
          side="groups"
          onSide={onSide}
          onAddGroup={onAddGroup}
          {...(onReminders ? { onReminders } : {})}
        />
        {groups.length > 0 ? <Net groups={groups} /> : null}
        <div
          data-groups=""
          style={{
            background: look.surface,
            borderRadius: B.card.radius,
            overflow: "hidden",
          }}
        >
          {ordered.map((g, i) => (
            <div
              key={g.id}
              style={{
                borderTop: i === 0 ? undefined : `1px solid ${look.line}`,
              }}
            >
              <button
                type="button"
                data-group={g.id}
                onClick={() => onOpenGroup(g.id)}
                style={{ ...row, color: look.ink }}
              >
                <span
                  aria-hidden
                  data-avatar=""
                  style={{
                    width: B.groupRow.avatar,
                    height: B.groupRow.avatar,
                    borderRadius: "50%",
                    background: look.soft,
                    color: look.softInk,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: B.groupRow.avatarSize,
                    fontWeight: 500,
                    flex: "none",
                  }}
                >
                  {initialOf(g.name)}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: B.groupRow.nameSize,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.name}
                </span>
                {g.myBalanceMinor === 0 ? (
                  <span
                    data-balance=""
                    style={{
                      fontSize: B.groupRow.settledSize,
                      color: look.muted,
                    }}
                  >
                    Settled
                  </span>
                ) : (
                  <span
                    data-balance=""
                    style={{
                      fontSize: B.groupRow.amountSize,
                      fontWeight: 500,
                      color: TONE[toneOf(g.myBalanceMinor)],
                    }}
                  >
                    {signedShort(g.myBalanceMinor, g.currency)}
                  </span>
                )}
              </button>
            </div>
          ))}
          <div
            style={{
              borderTop:
                ordered.length === 0 ? undefined : `1px solid ${look.line}`,
            }}
          >
            <button
              type="button"
              data-action="add-group-row"
              onClick={onAddGroup}
              style={{
                ...row,
                height: B.addRow.height,
                color: look.primary,
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              <span
                aria-hidden
                data-avatar=""
                style={{
                  width: B.addRow.avatar,
                  height: B.addRow.avatar,
                  borderRadius: "50%",
                  background: look.soft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                <svg
                  {...svgProps(B.addRow.icon, B.addRow.stroke)}
                  strokeLinejoin={undefined}
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              Add group
            </button>
          </div>
        </div>
      </div>
      <FloatingSlot>{floatingButton}</FloatingSlot>
    </LookScope>
  );
}
