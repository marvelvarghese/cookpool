"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SplitecoExpenseSummary, SplitecoMoney } from "@saas/contracts/spliteco";
import { Icon, Mark } from "./icons";
import { formatMoney, splitMoney } from "../lib/money";
import { initialOf, tintOf } from "../lib/people";
import { CATEGORY_TINTS } from "../lib/activity-text";
import { errorText, useSession } from "../lib/session";
import { rememberReturn, sessionStore } from "../lib/return-to";
import { readBack } from "../lib/handoff";
import { PAGER_TABS, TABS, nearestTab, pillPosition, showsAdd, tabIndexOf } from "../lib/tabs";
import { useSheetDrag } from "@saas/gestures/react/sheet-drag";
import { useEdgeBack } from "@saas/gestures/react/edge-back";
import { to } from "../lib/paths";

// ── Data ───────────────────────────────────────────────

export interface Load<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Read again; resolves once the new read has landed (or failed). The data shown stays until then. */
  reload(): Promise<void>;
}

/** Run `fn` with the session's client once signed in, again on `reload()` or when `deps` change. */
export function useLoad<T>(fn: (client: ReturnType<typeof useSession>["client"]) => Promise<T>, deps: React.DependencyList): Load<T> {
  const { client, token, ready } = useSession();
  const [state, setState] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  const waiting = React.useRef<(() => void)[]>([]);
  React.useEffect(() => {
    if (!ready || !token) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const done = () => {
      if (!live) return; // a newer read answers the waiters
      const w = waiting.current;
      waiting.current = [];
      for (const resolve of w) resolve();
    };
    fn(client).then(
      (data) => {
        if (live) setState({ data, error: null, loading: false });
        done();
      },
      (err: unknown) => {
        // A re-read that fails keeps what was shown (pull to refresh); a first read shows the error.
        if (live) setState((s) => ({ data: s.data, error: errorText(err), loading: false }));
        done();
      },
    );
    return () => {
      live = false;
    };
  }, [client, ready, token, tick, ...deps]);
  const reload = React.useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setTick((t) => t + 1);
      }),
    [],
  );
  return { ...state, reload };
}

/** Pages behind sign-in: Sign in first when there is no token. */
export function SignedIn({ children }: { children: React.ReactNode }) {
  const { ready, token } = useSession();
  const router = useRouter();
  // Its own first render always matches the prerendered page, even when the
  // session was read before this boundary hydrated.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (ready && !token) {
      // Back here after signing in (a live split's link, SE4).
      rememberReturn(sessionStore(), `${window.location.pathname}${window.location.search}`);
      router.replace("/sign-in");
    }
  }, [ready, token, router]);
  if (!mounted || !ready || !token) return <div className="spinner" role="status">Loading…</div>;
  return <>{children}</>;
}

export function Loading({ load, children }: { load: Load<unknown>; children: React.ReactNode }) {
  if (load.loading && !load.data) return <div className="spinner" role="status">Loading…</div>;
  if (load.error && !load.data) {
    return (
      <div className="stack" role="alert">
        <p className="error">{load.error}</p>
        <button className="btn ghost" onClick={() => void load.reload()}>Try again</button>
      </div>
    );
  }
  return <>{children}</>;
}

// ── Pieces ─────────────────────────────────────────────

export function Avatar({ id, name, me, size = 40 }: { id: string; name: string; me: string | null; size?: number }) {
  const t = tintOf(id, me);
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, background: t.bg, color: t.fg, fontSize: Math.round(size * 0.36) }}>
      {initialOf(name)}
    </span>
  );
}

export function BigMoney({ minor, currency, tone, size }: { minor: number; currency: string; tone: "get" | "owe" | "even"; size?: "md" }) {
  const { whole, fraction } = splitMoney(minor, currency);
  return (
    <div className={`bigmoney ${size ?? ""} ${tone}`}>
      <span className="w">{whole}</span>
      <span className="f">{fraction}</span>
    </div>
  );
}

/** "₹2,410.00 · $12.00" for amounts in several currencies; signs dropped. */
export function moneyList(list: readonly SplitecoMoney[]): string {
  return list.map((m) => formatMoney(Math.abs(m.amountMinor), m.currency)).join(" · ");
}

export function CategoryIcon({ expense, size = 42 }: { expense: Pick<SplitecoExpenseSummary, "kind" | "category" | "app"> & Partial<Pick<SplitecoExpenseSummary, "source">>; size?: number }) {
  // A Tripeco ride (tripeco TR-7): the car mark in Tripeco's lime.
  if (expense.source?.kind === "tripeco") {
    return (
      <span className="cat" style={{ width: size, height: size, background: "rgba(198,244,50,0.14)", color: "#C6F432" }}>
        <Icon name="transport" size={20} />
      </span>
    );
  }
  const key = expense.kind === "settlement" ? "payment" : expense.app === "cookpool" && expense.kind !== "expense" ? "cookpool" : (expense.category ?? "other");
  const t = CATEGORY_TINTS[key as keyof typeof CATEGORY_TINTS] ?? CATEGORY_TINTS.other;
  return (
    <span className="cat" style={{ width: size, height: size, background: t.tint, color: t.ink }}>
      <Icon name={key} size={20} />
    </span>
  );
}

export function BackButton({ href, label, onClick }: { href?: string; label: string; onClick?: () => void }) {
  const router = useRouter();
  if (href) {
    return (
      <Link href={href} className="iconbtn" aria-label={label}>
        <Icon name="back" />
      </Link>
    );
  }
  return (
    <button className="iconbtn" aria-label={label} onClick={onClick ?? (() => router.back())}>
      <Icon name="back" />
    </button>
  );
}

export function Brand() {
  return (
    <div className="inline" style={{ gap: 10 }}>
      <Mark />
      <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" }}>Spliteco</span>
    </div>
  );
}

/**
 * A bottom sheet: it closes from the scrim, Escape, or by dragging it down
 * (design §2). It is drawn on the body, so a page that moves (the tab pager,
 * pull to refresh) never carries it along.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const drag = useSheetDrag(onClose);
  const sheet = (
    <div className="scrim" ref={drag.scrim} onClick={onClose}>
      <section ref={drag.sheet} role="dialog" aria-modal="true" aria-label={label} className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        {children}
      </section>
    </div>
  );
  if (typeof document === "undefined") return sheet;
  // A host app that shows these screens (money-inside MN-8) marks where sheets go, inside its scoped wrapper.
  return createPortal(sheet, document.querySelector<HTMLElement>("[data-spliteco-portal]") ?? document.body);
}

export function useToast(): [React.ReactNode, (text: string) => void] {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 2600);
    return () => clearTimeout(t);
  }, [text]);
  return [text ? <div className="toast" role="status">{text}</div> : null, setText];
}

/** The adds-up bar: mint when it adds up, coral otherwise. */
export function AddsUpBar({ left, right, ok, ratio }: { left: string; right: string; ok: boolean; ratio: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return (
    <div className="stack s8">
      <div className="row-between" style={{ fontSize: 14 }}>
        <span className="muted">{left}</span>
        <b className={ok ? "okc" : "owe"} aria-live="polite">{right}</b>
      </div>
      <div className="bar" aria-hidden="true">
        <div style={{ width: `${pct}%`, background: ok ? "var(--ok)" : "var(--owe)" }} />
      </div>
    </div>
  );
}

// ── The floating tab bar ───────────────────────────────

/**
 * The floating tab bar (design §1): Home · Groups · Activity · You, the
 * current one a cobalt pill. `position` is a fractional tab index (1.5 is
 * halfway from Groups to Activity) for the pager to drive while a finger
 * swipes (SL2); left out, it is the address's tab. It is also set as the
 * bar's `--tab` CSS variable, which is all the pill reads. The round + floats
 * above the bar on Home, Groups and Activity: the one main action.
 * With `onTab` (the pager, SL2), tapping Home, Groups or Activity turns the
 * pager instead of loading the page: the swipe's twin. You stays a link.
 */
export function TabBar({ position, dragging = false, onTab }: { position?: number; dragging?: boolean; onTab?: (index: number) => void }) {
  const path = usePathname();
  const current = tabIndexOf(path);
  const at = pillPosition(position ?? (current < 0 ? 0 : current));
  const on = position === undefined ? current : nearestTab(at);
  return (
    <>
      {showsAdd(current) ? (
        <Link href={to("/add")} aria-label="Add an expense" className="add-fab">
          <Icon name="plus" size={26} stroke={2.2} />
        </Link>
      ) : null}
      <nav className={`tabbar ${dragging ? "dragging" : ""}`} aria-label="Main" style={{ "--tab": at } as React.CSSProperties}>
        {current >= 0 ? <span className="pill" aria-hidden="true" /> : null}
        {TABS.map((t, i) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={i === current ? "page" : undefined}
            className={i === on && !dragging ? "on" : undefined}
            onClick={(e) => {
              if (!onTab || i >= PAGER_TABS || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onTab(i);
            }}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

/**
 * "← Back to Cookpool" (SE3): shown on every screen of a tab that was opened
 * from Cookpool's "More in Spliteco", returning to the exact Cookpool page.
 */
export function BackToCookpool() {
  const [href, setHref] = React.useState<string | null>(null);
  React.useEffect(() => setHref(readBack(sessionStore(), window.location.host)), []);
  if (!href) return null;
  return (
    <a href={href} className="cookpool-back">
      <span aria-hidden="true">←</span> Back to Cookpool
    </a>
  );
}

/**
 * A page: with the floating tab bar (`nav`, the tabs' roots), or pushed
 * (`nav={false}`: Group, Add, Settle…), which hides the bar and goes back
 * with a swipe from the left edge — to `back` when given, else the previous
 * page (Home when there is none). Its twin is the screen's ← button.
 */
export function Screen({ children, nav = true, tight, back }: { children: React.ReactNode; nav?: boolean; tight?: boolean; back?: string }) {
  const router = useRouter();
  const goBack = React.useCallback(() => {
    if (back) router.push(back);
    else if (window.history.length > 1) router.back();
    else router.push(to("/"));
  }, [back, router]);
  const edge = useEdgeBack(goBack, !nav);
  return (
    <SignedIn>
      <div className="app" ref={edge.frame}>
        <div className="glow a" aria-hidden="true" />
        <div className="glow b" aria-hidden="true" />
        <main ref={edge.page} className={`page ${tight ? "tight" : ""} ${nav ? "with-nav" : ""}`}>
          <BackToCookpool />
          {children}
        </main>
      </div>
      {nav ? <TabBar /> : null}
    </SignedIn>
  );
}

/** `?id=…` from the address (pages are static; it is read in the browser and follows navigation). */
export function useQueryParam(name: string): string | null {
  const params = useSearchParams();
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  return ready ? params.get(name) : null;
}

export function useQueryParams(): URLSearchParams | null {
  const params = useSearchParams();
  const key = params.toString();
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  // A fresh object per address, so effects keyed on it re-run on navigation.
  return React.useMemo(() => (ready ? new URLSearchParams(key) : null), [ready, key]);
}
