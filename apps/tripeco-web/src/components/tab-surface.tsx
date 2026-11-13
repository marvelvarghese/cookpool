"use client";

// Home ↔ Vehicles ↔ Groups as one surface (tripeco TR-5, design §5): the
// three pages sit side by side in a pager; the tab bar is the tap twin. Each
// of `/`, `/vehicles` and `/groups` renders this surface, opens on its tab and
// writes the settled tab back to the address. Pull down re-reads; so does
// coming back to the app.

import * as React from "react";
import { usePathname } from "next/navigation";
import { usePager } from "@saas/gestures/react/pager";
import { usePull } from "@saas/gestures/react/pull";
import { SignedIn, TabBar, useLoad, useToast } from "./ui";
import { HomeTab } from "./tabs/home-tab";
import { VehiclesTab } from "./tabs/vehicles-tab";
import { GroupsTab } from "./tabs/groups-tab";
import { TAB_PATHS, tabIndexOf, tabPath } from "@/lib/home";

export function TabSurface({ tab }: { tab: number }) {
  return (
    <SignedIn>
      <Surface initial={tab} />
    </SignedIn>
  );
}

function Surface({ initial }: { initial: number }) {
  const path = usePathname();
  const fromAddress = tabIndexOf(path);
  const [index, setIndex] = React.useState(fromAddress >= 0 ? fromAddress : initial);

  React.useEffect(() => {
    if (fromAddress >= 0) setIndex(fromAddress);
  }, [fromAddress]);
  React.useEffect(() => {
    const want = tabPath(index);
    if (window.location.pathname !== want) window.history.replaceState(null, "", want);
  }, [index]);

  const me = useLoad((c) => c.tripeco.me(), []);
  const groups = useLoad((c) => c.spliteco.groups(), []);
  const reloadMe = me.reload;
  const reloadGroups = groups.reload;
  const refresh = React.useCallback(() => Promise.all([reloadMe(), reloadGroups()]), [reloadMe, reloadGroups]);
  const { toast, show } = useToast();

  const pull = usePull(async () => {
    await refresh();
    show("Up to date");
  });
  React.useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [refresh]);

  const pager = usePager({ index, count: TAB_PATHS.length, onChange: setIndex });

  // A neighbour shown mid-drag sits at the viewport's top, not the page's.
  const [lift, setLift] = React.useState(0);
  React.useEffect(() => {
    if (pager.dragging) setLift(window.scrollY);
  }, [pager.dragging]);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.scrollY > 0) window.scrollTo(0, 0);
    setLift(0);
  }, [index]);

  const pages = [
    <HomeTab key="home" load={me} show={show} />,
    <VehiclesTab key="vehicles" load={me} />,
    <GroupsTab key="groups" groups={groups} />,
  ];

  return (
    <>
      <div className="app">
        <div ref={pull.spinner} className={`pull-spinner ${pull.refreshing ? "spinning" : ""}`} aria-hidden="true">
          <span />
        </div>
        <div ref={pull.surface} className="pull-surface">
          <div ref={pager.viewport} className="pager">
            <div ref={pager.track} className="pager-track tabs">
              {pages.map((page, i) => {
                const away = i !== index;
                return (
                  <main
                    key={i}
                    className="page"
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
      <TabBar active={Math.round(pager.position)} onTab={setIndex} />
      {toast}
    </>
  );
}
