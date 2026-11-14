"use client";

import * as React from "react";
import Link from "./link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { BOARD_FONT } from "@saas/spliteco-ui/board";
import { cn } from "@/lib/cn";
import { listenForDrags, prefersReducedMotion } from "@/lib/gestures";
import { normalizePath, transitions } from "@/lib/transitions";
import { isTabActiveIn, kitchenTabs } from "./nav";
import { barDirection, barTabAt } from "./tab-swipe";
import { rememberTab } from "./tab-preview";
import { navigate } from "./transition-ui";
import { kitchenIcon } from "./icons";

/**
 * Cookpool's bottom tab bar, below 900px (CP-5): Home · Pantry · + Add ·
 * Groups · People. The centre Add is a raised circle that opens the Add
 * sheet, in the app's one primary green (SM-10: it was tomato, a second
 * "this is the action" colour). Fixed to the bottom with the home-indicator
 * inset; every cell is at least 60px tall.
 *
 * In the new frame (`newFrame`, cookpool-recipes RC-2): Home · Pantry · Cook ·
 * Money · You, with no + Add, on the revamp's floating bar (RV-2,
 * `FloatingTabBar`).
 */
export function KitchenTabBar({ onAdd, addOpen, newFrame = false }: { onAdd: () => void; addOpen: boolean; newFrame?: boolean }) {
  return newFrame ? <FloatingTabBar /> : <TodayTabBar onAdd={onAdd} addOpen={addOpen} />;
}

/** Today's tab bar (prod): Home · Pantry · + Add · Groups · People. */
function TodayTabBar({ onAdd, addOpen }: { onAdd: () => void; addOpen: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      data-toast-above=""
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-safe backdrop-blur-md min-[900px]:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {kitchenTabs(false).map((item) => {
          if (item.kind === "action") {
            return (
              <li key={item.id} className="flex justify-center">
                <button
                  type="button"
                  onClick={onAdd}
                  aria-haspopup="dialog"
                  aria-expanded={addOpen}
                  className="group -mt-6 flex min-h-[64px] w-full flex-col items-center gap-1 rounded-xl text-xs font-medium text-foreground focus-visible:outline-none"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_hsl(var(--primary)/0.32)] ring-4 ring-card transition-transform group-active:scale-95 group-focus-visible:ring-ring">
                    <Plus className="h-7 w-7" strokeWidth={2.5} aria-hidden />
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            );
          }
          const active = isTabActiveIn(false, item.id, pathname);
          const Icon = kitchenIcon(item.icon);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A light tap of the motor as the bar's highlight crosses to another tab, where the phone has one; never with reduced motion. */
function tick(): void {
  if (prefersReducedMotion()) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(8);
  } catch {
    // Some browsers refuse vibrate outside a user gesture; a missing tick is fine.
  }
}

/** The floating bar's padding (Tailwind `p-1.5`), inside which the five cells sit. */
const BAR_PAD_PX = 6;

/**
 * The new frame's tab bar (cookpool-revamp RV-2, design §3, the `HomeRevamp`
 * board's <nav>): it floats 12px from the sides and 14px from the bottom (or
 * above the home indicator, whichever is higher), radius 24, on `nav-bg` (ink
 * in light mode, the card in dark). The current tab is filled with the accent,
 * its words `on-accent`; the others are `nav-ink`. Labels are 11px, Medium.
 *
 * Sliding along it (RV-12): a finger pressed on the bar and moved sideways
 * takes the fill with it, gliding from tab to tab under the finger with a
 * light haptic at each crossing; lifting opens the tab it is on (the page
 * slides that way, `swipe-next`/`swipe-prev`). A plain tap is the link's, as
 * before. The slide reads the finger through PW-7's `listenForDrags`.
 */
function FloatingTabBar() {
  const pathname = usePathname();
  // Money's boards draw the bar on the page's surface with a tinted current tab (MY-18); the other tabs keep RV-2's.
  const board = isMoneyBoardPath(pathname);
  const tabs = kitchenTabs(true).filter((item) => item.kind === "link");
  const active = tabs.findIndex((item) => isTabActiveIn(true, item.id, pathname));
  const nav = React.useRef<HTMLElement>(null);
  // The tab under the sliding finger; null when no slide is on (the bar is exactly RV-2's).
  const [slideAt, setSlideAt] = React.useState<number | null>(null);
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const hrefs = tabs.map((t) => t.href).join(" ");

  React.useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const list = hrefs.split(" ");
    let at = -1;
    let rect = { left: 0, width: 0 };
    let startX = 0;
    let swallow = 0;
    // A slide that lifted on a tab must not also be the link's click.
    const onClick = (e: MouseEvent) => {
      if (performance.now() < swallow) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("click", onClick, true);
    const stop = listenForDrags(el, {
      begin(start) {
        const r = el.getBoundingClientRect();
        rect = { left: r.left, width: r.width };
        startX = start.x;
        at = -1;
        return (dx, dy) => Math.abs(dx) > Math.abs(dy);
      },
      move(dx) {
        const next = barTabAt(startX + dx, rect, list.length, BAR_PAD_PX);
        if (at === -1) {
          // The fill starts where it is (the current tab), then glides under the finger.
          at = activeRef.current >= 0 ? activeRef.current : next;
          setSlideAt(at);
        }
        if (next === at) return;
        at = next;
        tick();
        requestAnimationFrame(() => setSlideAt(next));
      },
      end(_drag, cancelled) {
        const to = at;
        at = -1;
        swallow = performance.now() + 500;
        const from = activeRef.current;
        const direction = barDirection(from, to);
        const href = list[to];
        // Lifting on the tab already shown does nothing (on a page under it, it goes to its root, as a tap does).
        const here = href !== undefined && normalizePath(window.location.pathname) === normalizePath(href);
        if (cancelled || to < 0 || !href || here) {
          setSlideAt(null);
          return;
        }
        rememberTab(window.location.pathname);
        const go = () => {
          if (!navigate(href, { kind: "tab" })) window.location.assign(href);
        };
        if (direction) transitions.tabSwiped(direction, go);
        else go();
        // The fill stays on the chosen tab until the page shows it current.
        window.setTimeout(() => setSlideAt(null), 1500);
      },
    });
    return () => {
      stop();
      el.removeEventListener("click", onClick, true);
    };
  }, [hrefs]);

  // The new tab is current: the bar is RV-2's again.
  React.useEffect(() => setSlideAt(null), [pathname]);

  const lit = slideAt ?? active;
  return (
    <nav
      ref={nav}
      aria-label="Main"
      data-toast-above=""
      // It stays put while the page moves (RC-11's page transitions).
      data-vt-keep="tabs"
      // Its drags are its own (the slide): the edge swipe never starts here.
      data-gestures="off"
      {...(board ? { "data-look": "cookpool", "data-money-bar": "", style: { fontFamily: BOARD_FONT, fontVariantNumeric: "tabular-nums", color: "var(--look-ink)" } } : {})}
      className={cn(
        "fixed inset-x-3 bottom-[var(--cp-bar-bottom)] z-40 mx-auto max-w-lg",
        board
          ? "box-border h-[var(--cp-bar-h)] rounded-[26px] bg-[var(--look-surface)] px-1.5 shadow-[0_8px_28px_rgba(0,0,0,.12)] min-[900px]:hidden"
          : "h-[var(--cp-bar-h)] rounded-[24px] bg-cp-nav-bg p-1.5 shadow-cp-nav min-[900px]:hidden",
      )}
    >
      {slideAt !== null ? (
        <span
          aria-hidden
          data-tab-highlight=""
          className={cn(
            "pointer-events-none absolute w-[calc((100%-12px)/5)] transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none",
            board ? "bottom-2 left-1.5 top-2 rounded-[18px] bg-[var(--look-soft)]" : "bottom-1.5 left-1.5 top-1.5 rounded-[18px] bg-primary",
          )}
          style={{ transform: `translate3d(${slideAt * 100}%, 0, 0)` }}
        />
      ) : null}
      <ul className="relative grid h-full grid-cols-5 items-center">
        {tabs.map((item, i) => {
          const current = i === active;
          const Icon = kitchenIcon(item.icon);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center rounded-[18px] text-[11px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  board
                    ? "mx-0 h-[52px] gap-[2px] leading-[normal] " +
                        (slideAt === null ? (current ? "mx-[2px] bg-[var(--look-soft)] font-semibold text-[var(--look-navInk)]" : "font-medium text-[var(--look-muted)]") : i === lit ? "mx-[2px] font-semibold text-[var(--look-navInk)]" : "font-medium text-[var(--look-muted)]")
                    : "min-h-[56px] gap-0.5 font-medium " +
                      // While a slide is on, the fill is the gliding highlight's; the words follow it.
                      (slideAt === null ? (current ? "bg-primary text-primary-foreground" : "text-cp-nav-ink") : i === lit ? "text-primary-foreground" : "text-cp-nav-ink"),
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={board ? 1.9 : 2} aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Money's own pages (`/money`, `/money?side=people`, a person's page): the boards' tab bar. */
export function isMoneyBoardPath(pathname: string | null | undefined): boolean {
  return pathname === "/money" || (pathname?.startsWith("/money/") ?? false);
}
