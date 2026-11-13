"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSheetDrag } from "@saas/gestures/react/sheet-drag";
import { useEdgeBack } from "@saas/gestures/react/edge-back";
import { Icon } from "./icons";
import { errorText, useSession } from "@/lib/session";
import { rememberReturn, sessionStore } from "@/lib/return-to";
import { initialOf, tintOf } from "@/lib/people";

// ── Data ───────────────────────────────────────────────

export interface Load<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): Promise<void>;
  /** Replace what is shown (an optimistic change, or a write's answer). */
  set(data: T): void;
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
      if (!live) return;
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
  const set = React.useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, set };
}

/** Pages behind sign-in: Sign in first when there is no token. */
export function SignedIn({ children }: { children: React.ReactNode }) {
  const { ready, token } = useSession();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (ready && !token) {
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

// ── Screens ────────────────────────────────────────────

/** A pushed screen: back or close on the left, the title, an optional action; the edge swipe goes back. */
export function Screen({
  title,
  back,
  close,
  action,
  children,
}: {
  title?: React.ReactNode;
  /** Where back goes when there is no history ("/"). */
  back?: string;
  close?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const leave = React.useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace(back ?? close ?? "/");
  }, [router, back, close]);
  const edge = useEdgeBack(leave);
  return (
    <div className="app" ref={edge.frame}>
      <main className="page" ref={edge.page}>
        <header className="head">
          <button className="icon-btn plain" aria-label={close ? "Close" : "Back"} onClick={leave}>
            <Icon name={close ? "close" : "back"} />
          </button>
          {typeof title === "string" ? <span className="title">{title}</span> : (title ?? <span className="title" />)}
          {action ?? <span style={{ width: 40 }} />}
        </header>
        {children}
      </main>
    </div>
  );
}

/** A bottom sheet: tap outside or drag it down to close. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const drag = useSheetDrag(onClose);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => setHost(document.body), []);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  if (!host) return null;
  // react-dom's portal type comes from another @types/react than the app's (as in spliteco-web).
  return createPortal(
    <div className="scrim" ref={drag.scrim} onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} ref={drag.sheet} onClick={(e) => e.stopPropagation()}>
        <div className="grab" aria-hidden="true" />
        {children}
      </div>
    </div>,
    host,
  ) as unknown as React.ReactElement;
}

/** A toast with an optional Undo, gone after 3.6 s. */
export function useToast(): { toast: React.ReactNode; show(text: string, undo?: () => void): void } {
  const [state, setState] = React.useState<{ text: string; undo?: (() => void) | undefined } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = React.useCallback((text: string, undo?: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ text, undo });
    timer.current = setTimeout(() => setState(null), 3600);
  }, []);
  const toast = state ? (
    <div className="toast" role="status">
      <span>{state.text}</span>
      {state.undo ? (
        <button
          onClick={() => {
            state.undo?.();
            setState(null);
          }}
        >
          Undo
        </button>
      ) : null}
    </div>
  ) : null;
  return { toast, show };
}

export function Face({ id, name, me, size = 40 }: { id: string; name: string; me: string | null; size?: number }) {
  const t = tintOf(id, me);
  return (
    <span className="face" aria-hidden="true" style={{ width: size, height: size, background: t.bg, color: t.fg, fontSize: Math.round(size * 0.38) }}>
      {initialOf(name)}
    </span>
  );
}

export const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/vehicles", label: "Vehicles", icon: "car" },
  { href: "/groups", label: "Groups", icon: "people" },
] as const;

/** Home · Vehicles · Groups. `onTab` turns the pager when there is one (the tap twin of the swipe). */
export function TabBar({ active, onTab }: { active: number; onTab?: (i: number) => void }) {
  return (
    <nav className="tabbar" aria-label="Tripeco">
      <div className="tabbar-inner">
        {TABS.map((t, i) =>
          onTab ? (
            <button key={t.href} aria-current={i === active ? "page" : undefined} onClick={() => onTab(i)}>
              <Icon name={t.icon} />
              {t.label}
            </button>
          ) : (
            <Link key={t.href} href={t.href} aria-current={i === active ? "page" : undefined}>
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
