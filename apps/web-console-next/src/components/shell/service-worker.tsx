"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { qk } from "@/lib/query-keys";
import { writesInFlight } from "@/lib/optimistic";
import { isOffline } from "@/lib/connection";
import { undoOffersOpen } from "@/components/kitchen/undo-toast";
import { SERVICE_WORKER } from "@/service-worker/switch.mjs";
import { dropThisDevicePush } from "@/lib/push-device";
import {
  SW_URL,
  activateWaiting,
  adoptIfSameBuild,
  reloadsOnReturn,
  removeWorkers,
  tellWorkerAccount,
  tellWorkerSignedOut,
  updateOffered,
  workersSupported,
} from "@/lib/sw-client";

/** Only a production build registers the worker (`next dev` has no `/sw.js` and must never be served by one). */
const PRODUCTION = process.env.NODE_ENV === "production";

/** How often the update offer looks again at what it waits for (a write on its way, an Undo on screen). */
const GATE_MS = 500;

/** If the new worker has not taken over this long after Reload, reload anyway (from the network). */
const RELOAD_FALLBACK_MS = 4000;

/** At most one update check per this long when the app comes back. */
const CHECK_EVERY_MS = 60_000;

/**
 * Cookpool's service worker, page side (PW-4, cookpool-app design §3), in
 * the root layout:
 *
 * - REGISTERS `/sw.js` in production builds once the page has loaded; a
 *   failure leaves the app as it was. With the kill switch off
 *   (src/service-worker/switch.mjs) it unregisters instead, and `next dev`
 *   unregisters any worker a production build left on the same origin.
 * - TELLS THE WORKER WHO IS SIGNED IN on every load and after sign-in (the
 *   profile's subject id, and a hash of the session's token), and that
 *   nobody is when there is no session (sign-out and a 401 also tell it,
 *   through the session's `setToken(null)`). With nobody signed in, this
 *   device's push subscription goes too (PW-6).
 * - A NEW BUILD installs in the background and waits. If this page already
 *   is that build (the same build id: it came from the network while the old
 *   worker was in charge) the new worker takes over silently. Otherwise the shared toast
 *   offers "New version · Reload" — never while a write is on its way or its
 *   Undo is on screen, never offline, never on sign-in. Reload: the waiting
 *   worker takes over, and the page reloads once. Brought back after more
 *   than a day with a build waiting, the app reloads itself.
 */
export function ServiceWorker() {
  useWorkerAccount();
  useWorkerUpdates();
  return null;
}

function useWorkerAccount(): void {
  const { token, client } = useSession();
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!PRODUCTION || SERVICE_WORKER !== "on" || !workersSupported()) return;
    if (!token) {
      tellWorkerSignedOut();
      // Nobody is signed in: no push subscription is left on this device (PW-6).
      dropThisDevicePush();
      return;
    }
    let live = true;
    // The profile read every signed-in page makes anyway (the same key, so
    // one request): the account is the one THIS token belongs to. The
    // session clears the query cache when the token changes, before this.
    void qc
      .fetchQuery({ queryKey: qk.profile(), queryFn: async () => (await client.auth.getProfile()).user, staleTime: 0 })
      .then((user) => {
        if (live && user?.id) void tellWorkerAccount(user.id, token);
      })
      .catch(() => undefined); // offline: the worker keeps the account it knows
    return () => {
      live = false;
    };
  }, [token, client, qc]);
}

function useWorkerUpdates(): void {
  const qc = useQueryClient();
  const { toast, dismiss } = useToast();
  const [waiting, setWaiting] = React.useState<ServiceWorker | null>(null);
  const registration = React.useRef<ServiceWorkerRegistration | null>(null);
  const applying = React.useRef(false);
  const snoozed = React.useRef(false);
  const offerId = React.useRef<number | null>(null);

  const apply = React.useCallback((worker: ServiceWorker) => {
    if (applying.current) return;
    applying.current = true;
    activateWaiting(worker);
    window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
  }, []);

  // Register, and notice a build that installs and waits.
  React.useEffect(() => {
    if (!workersSupported()) return;
    const sw = navigator.serviceWorker;
    if (!PRODUCTION || SERVICE_WORKER !== "on") {
      void removeWorkers();
      return;
    }
    let stopped = false;
    let reloaded = false;
    const onControllerChange = () => {
      // Only the swap this page asked for reloads it (a first install or an
      // adopted build takes over without one).
      if (!applying.current || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    sw.addEventListener("controllerchange", onControllerChange);
    const consider = (worker: ServiceWorker) => {
      // No controller: a first install, which takes over by itself.
      if (stopped || !sw.controller) return;
      void adoptIfSameBuild(worker).then((adopted) => {
        if (!stopped && !adopted) setWaiting(worker);
      });
    };
    const start = () => {
      sw.register(SW_URL, { scope: "/", updateViaCache: "none" })
        .then((r) => {
          if (stopped) return;
          registration.current = r;
          if (r.waiting) consider(r.waiting);
          r.addEventListener("updatefound", () => {
            const worker = r.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed") consider(worker);
            });
          });
        })
        .catch(() => undefined);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      stopped = true;
      sw.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", start);
    };
  }, []);

  // The offer, shown and hidden as what it waits for comes and goes.
  React.useEffect(() => {
    if (!waiting) return;
    let hiding = false;
    const tick = () => {
      const show = updateOffered({
        waiting: !applying.current,
        writesInFlight: writesInFlight(qc),
        undoOffersOpen: undoOffersOpen(),
        offline: isOffline(),
        pathname: window.location.pathname,
        snoozed: snoozed.current,
      });
      if (show && offerId.current === null) {
        offerId.current = toast({
          kind: "default",
          title: "New version",
          duration: Infinity,
          action: { label: "Reload", onClick: () => apply(waiting) },
          onClose: () => {
            offerId.current = null;
            if (!hiding && !applying.current) snoozed.current = true;
          },
        });
      } else if (!show && offerId.current !== null) {
        hiding = true;
        dismiss(offerId.current);
        offerId.current = null;
        hiding = false;
      }
    };
    tick();
    const timer = window.setInterval(tick, GATE_MS);
    return () => {
      window.clearInterval(timer);
      if (offerId.current !== null) {
        dismiss(offerId.current);
        offerId.current = null;
      }
    };
  }, [waiting, qc, toast, dismiss, apply]);

  // Back in the foreground: look for a new build; after more than a day
  // away, with one waiting, reload into it.
  React.useEffect(() => {
    if (!PRODUCTION || SERVICE_WORKER !== "on" || !workersSupported()) return;
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    let checkedAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const awayMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      snoozed.current = false;
      const r = registration.current;
      if (!r || Date.now() - checkedAt < CHECK_EVERY_MS) return;
      checkedAt = Date.now();
      void r
        .update()
        .catch(() => undefined)
        .then(async () => {
          const worker = r.waiting ?? (await installed(r.installing));
          const ready = reloadsOnReturn({
            waiting: !!worker && !!navigator.serviceWorker.controller,
            awayMs,
            writesInFlight: writesInFlight(qc),
            offline: isOffline(),
            pathname: window.location.pathname,
          });
          if (ready && worker) apply(worker);
        });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [qc, apply]);
}

/** The worker once it has installed (or null if it does not within 30 s). */
function installed(worker: ServiceWorker | null): Promise<ServiceWorker | null> {
  if (!worker) return Promise.resolve(null);
  if (worker.state === "installed") return Promise.resolve(worker);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 30_000);
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        window.clearTimeout(timer);
        resolve(worker);
      } else if (worker.state === "redundant") {
        window.clearTimeout(timer);
        resolve(null);
      }
    });
  });
}
