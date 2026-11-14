"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { SplitecoFriendBalance } from "@saas/contracts/spliteco";
import { BackToCookpool, SignedIn, TabBar, useLoad } from "./ui";
import { usePager } from "@saas/gestures/react/pager";
import { usePull } from "@saas/gestures/react/pull";
import { HomeTab } from "./tabs/home-tab";
import { GroupsTab } from "./tabs/groups-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { PAGER_TABS } from "../lib/tabs";
import { pagerIndexOf, pagerPath, remindErrorText } from "../lib/home";
import { DelayedSends, UNDO_MS } from "../lib/delayed";
import { canRemind } from "../lib/settle";
import { errorReason, errorText, newIdempotencyKey, useSession } from "../lib/session";
import { useMe } from "../lib/me";

export interface ToastValue {
  text: string;
  undo?: () => void;
}

/**
 * Home ↔ Groups ↔ Activity as one surface (spliteco-calm SL2, design §2):
 * the three pages sit side by side in a pager, the content follows a
 * sideways finger and the tab bar's pill follows it (fractional position).
 * Each of `/`, `/groups` and `/activity` renders this surface; it opens on
 * the address's tab and, when it settles on another, writes that address
 * back with `history.replaceState` (Next keeps `usePathname` in step, so
 * Back and deep links land on the right tab). Tapping a tab turns the pager
 * (the twin); You stays a normal link. Pull down at the top re-reads all
 * three, as does coming back to the app.
 */
export function TabSurface({ tab }: { tab: number }) {
  return (
    <SignedIn>
      <Surface initial={tab} />
    </SignedIn>
  );
}

function Surface({ initial }: { initial: number }) {
  const path = usePathname();
  const params = useSearchParams();
  const fromAddress = pagerIndexOf(path);
  const [index, setIndex] = React.useState(fromAddress >= 0 ? fromAddress : initial);
  const [friends, setFriends] = React.useState(params.get("tab") === "friends");
  const { me } = useMe();
  const meId = me?.id ?? null;

  // Back (or any outside change of address) turns the pager to match.
  React.useEffect(() => {
    if (fromAddress >= 0) setIndex(fromAddress);
  }, [fromAddress]);

  // Settled on a tab: its address, without a new history entry (tabs are siblings).
  React.useEffect(() => {
    const want = pagerPath(index, { friends });
    if (`${window.location.pathname}${window.location.search}` !== want) window.history.replaceState(null, "", want);
  }, [index, friends]);

  const home = useLoad((c) => c.spliteco.home(), []);
  const groups = useLoad((c) => c.spliteco.groups(), []);
  const activity = useLoad((c) => c.spliteco.activity(), []);
  const reloadHome = home.reload;
  const reloadGroups = groups.reload;
  const reloadActivity = activity.reload;
  const refresh = React.useCallback(
    () => Promise.all([reloadHome(), reloadGroups(), reloadActivity()]),
    [reloadHome, reloadGroups, reloadActivity],
  );

  const [toast, setToast] = React.useState<(ToastValue & { id: number }) | null>(null);
  const show = React.useCallback((t: ToastValue) => setToast({ ...t, id: Date.now() }), []);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((now) => (now?.id === toast.id ? null : now)), toast.undo ? UNDO_MS : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const pull = usePull(async () => {
    await refresh();
    show({ text: "Up to date" });
  });

  // The pull's twin: the screen re-reads when it comes back into view.
  React.useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [refresh]);

  const pager = usePager({ index, count: PAGER_TABS, onChange: setIndex });

  // A neighbour drawn while a finger drags shows its own top, wherever this page is scrolled.
  const [lift, setLift] = React.useState(0);
  React.useEffect(() => {
    if (pager.dragging) setLift(window.scrollY);
  }, [pager.dragging]);
  const firstIndex = React.useRef(true);
  React.useEffect(() => {
    if (firstIndex.current) {
      firstIndex.current = false;
      return;
    }
    if (window.scrollY > 0) window.scrollTo(0, 0);
    setLift(0);
  }, [index]);

  // ── Remind, with an Undo that is real: the send waits UNDO_MS ──
  const { client } = useSession();
  const live = React.useRef(true);
  const sends = React.useMemo(() => new DelayedSends(), []);
  const reminded = React.useRef(new Map<string, string>());
  React.useEffect(() => {
    live.current = true;
    const leave = () => sends.flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      sends.flush();
      live.current = false;
    };
  }, [sends]);

  const remind = React.useCallback(
    (p: SplitecoFriendBalance) => {
      const name = p.name ?? "Someone";
      const id = p.subjectId;
      if (sends.isWaiting(id) || !canRemind(reminded.current.get(id) ?? null, new Date())) {
        show({ text: `You reminded ${name} in the last 24 hours` });
        return;
      }
      sends.schedule(id, () => {
        client.spliteco.remind({ to: id, groupId: null }, { idempotencyKey: newIdempotencyKey() }).then(
          (r) => {
            reminded.current.set(id, r.reminder.sentAt);
          },
          (err: unknown) => {
            if (errorReason(err) === "reminded_recently") reminded.current.set(id, new Date().toISOString());
            if (live.current) show({ text: remindErrorText(errorReason(err), name, errorText(err)) });
          },
        );
      });
      show({
        text: `Reminded ${name}`,
        undo: () => {
          if (sends.undo(id)) show({ text: "Reminder cancelled" });
        },
      });
    },
    [client, sends, show],
  );

  const openFriends = React.useCallback(() => {
    setFriends(true);
    setIndex(1);
  }, []);

  const pages = [
    <HomeTab key="home" load={home} groups={groups.data} me={meId} onSeeAll={openFriends} onRemind={remind} />,
    <GroupsTab key="groups" load={groups} me={meId} friends={friends} setFriends={setFriends} />,
    <ActivityTab key="activity" load={activity} me={meId} />,
  ];

  return (
    <>
      <div className="app">
        <div className="glow a" aria-hidden="true" />
        <div className="glow b" aria-hidden="true" />
        <div ref={pull.spinner} className={`pull-spinner ${pull.refreshing ? "spinning" : ""}`} aria-hidden="true">
          <span />
        </div>
        <div ref={pull.surface} className="pull-surface">
          <BackToCookpool />
          <div ref={pager.viewport} className="pager">
            <div ref={pager.track} className="pager-track tabs">
              {pages.map((page, i) => {
                const away = i !== index;
                return (
                  <main
                    key={i}
                    className="page with-nav tab-page"
                    aria-hidden={away ? "true" : undefined}
                    inert={away}
                    style={away && lift > 0 ? { transform: `translateY(${lift}px)` } : undefined}
                  >
                    {page}
                  </main>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <TabBar position={pager.position} dragging={pager.dragging} onTab={setIndex} />
      {toast ? (
        <div className={`toast ${toast.undo ? "undoable" : ""}`} role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" className="undo" onClick={toast.undo}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
