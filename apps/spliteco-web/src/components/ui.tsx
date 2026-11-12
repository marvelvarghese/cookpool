"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SplitecoExpenseSummary, SplitecoMoney } from "@saas/contracts/spliteco";
import { Icon, Mark } from "./icons";
import { formatMoney, splitMoney } from "@/lib/money";
import { initialOf, tintOf } from "@/lib/people";
import { CATEGORY_TINTS } from "@/lib/activity-text";
import { errorText, useSession } from "@/lib/session";

// ── Data ───────────────────────────────────────────────

export interface Load<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): void;
}

/** Run `fn` with the session's client once signed in, again on `reload()` or when `deps` change. */
export function useLoad<T>(fn: (client: ReturnType<typeof useSession>["client"]) => Promise<T>, deps: React.DependencyList): Load<T> {
  const { client, token, ready } = useSession();
  const [state, setState] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!ready || !token) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(client).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (err: unknown) => live && setState({ data: null, error: errorText(err), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [client, ready, token, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
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
    if (ready && !token) router.replace("/sign-in");
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
        <button className="btn ghost" onClick={load.reload}>Try again</button>
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

export function CategoryIcon({ expense, size = 42 }: { expense: Pick<SplitecoExpenseSummary, "kind" | "category" | "app">; size?: number }) {
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
      <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em" }}>Spliteco</span>
    </div>
  );
}

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label={label} className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        {children}
      </section>
    </div>
  );
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

// ── Bottom nav ─────────────────────────────────────────

const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/groups", label: "Groups", icon: "groups" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/you", label: "You", icon: "you" },
] as const;

export function BottomNav() {
  const path = usePathname();
  const tab = (t: (typeof TABS)[number]) => {
    const on = t.href === "/" ? path === "/" : path.startsWith(t.href);
    return (
      <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}>
        <Icon name={t.icon} size={22} />
        <span>{t.label}</span>
      </Link>
    );
  };
  return (
    <nav className="nav" aria-label="Main">
      <div>
        {tab(TABS[0])}
        {tab(TABS[1])}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Link href="/add" aria-label="Add an expense" className="add" style={{ height: 58, padding: 0, gap: 0 }}>
            <Icon name="plus" size={26} stroke={2.2} />
          </Link>
        </div>
        {tab(TABS[2])}
        {tab(TABS[3])}
      </div>
    </nav>
  );
}

/** A page under the bottom nav, with the canvas's background glow. */
export function Screen({ children, nav = true, tight }: { children: React.ReactNode; nav?: boolean; tight?: boolean }) {
  return (
    <SignedIn>
      <div className="app">
        <div className="glow a" aria-hidden="true" />
        <div className="glow b" aria-hidden="true" />
        <main className={`page ${tight ? "tight" : ""}`}>{children}</main>
      </div>
      {nav ? <BottomNav /> : null}
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
