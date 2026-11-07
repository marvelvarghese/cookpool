"use client";

import * as React from "react";
import type { Cookpool } from "@saas/sdk";
import {
  allTargets,
  apiTargets,
  deployEnv,
  isLocked,
  createClient,
  type ApiTarget,
} from "./api";
import { appConfig } from "./app-config";
import { tellWorkerSignedOut } from "./sw-client";
import { dropThisDevicePush } from "./push-device";

// Keys are built per call, not at import: the storage prefix is part of the app
// config (saas-console-artifact CA1), which the browser resolves on first use.
const tokenKey = (): string => `${appConfig().storagePrefix}.token`;
const targetKey = (): string => `${appConfig().storagePrefix}.target`;

/**
 * Read the persisted bearer token straight from localStorage (client only).
 * Shared by the provider's initial state and the auth guard so both observe the
 * exact same source of truth — the guard never bounces a user who actually has
 * a token, even before React state has propagated.
 */
export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(tokenKey());
  } catch {
    return null;
  }
}

interface SessionCtx {
  client: Cookpool;
  target: ApiTarget;
  token: string | null;
  setToken: (t: string | null) => void;
  setTarget: (t: ApiTarget) => void;
  availableTargets: ApiTarget[];
  isLocked: boolean;
  deployEnv: string | undefined;
  /**
   * Be told when the API refuses the current token with a 401 (Cookpool
   * SI-5): the session has ended. Returns the unsubscribe. A 401 for a token
   * that has since been replaced is not reported.
   */
  onUnauthorized: (listener: () => void) => () => void;
}

const Ctx = React.createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Read persisted session synchronously in the initializer (client only). This
  // means the token is already present on the *first* client render, so the auth
  // guard never observes a false `null` and bounces an authenticated user to
  // /login on a hard refresh or deep link. SSR returns null and the shell gates
  // on `ready` (set in an effect), so the committed markup stays consistent.
  const [target, setTargetState] = React.useState<ApiTarget>(() => {
    const targets = apiTargets();
    // Prerendering (SM-2) knows no host, so no environment; and a build locked
    // to an environment with no API target would find none. The server makes
    // no API call, so any target is harmless there; the browser resolves its
    // own on this same first render.
    if (typeof window === "undefined") return targets[0] ?? allTargets()[0]!;
    try {
      const saved = window.localStorage.getItem(targetKey());
      return targets.find((t) => t.name === saved) ?? targets[0]!;
    } catch {
      return targets[0]!;
    }
  });
  const [token, setTokenState] = React.useState<string | null>(() => readStoredToken());

  // 401s are reported only while the token that drew them is still the
  // current one, so a late answer to a replaced token cannot end a new session.
  const tokenRef = React.useRef(token);
  tokenRef.current = token;
  const listeners = React.useRef(new Set<() => void>());
  const onUnauthorized = React.useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const client = React.useMemo(
    () =>
      createClient(target, token, () => {
        if (!token || tokenRef.current !== token) return;
        for (const listener of [...listeners.current]) listener();
      }),
    [target, token],
  );

  const setToken = React.useCallback((t: string | null) => {
    setTokenState(t);
    // Signed out (on purpose, or a 401 that ended the session): the service
    // worker deletes the account's last-seen data now, before the page leaves
    // (Cookpool PW-4), and this device stops getting the person's
    // notifications and loses the icon's count (PW-6).
    if (!t) {
      tellWorkerSignedOut();
      dropThisDevicePush();
    }
    if (typeof window !== "undefined") {
      try {
        if (t) window.localStorage.setItem(tokenKey(), t);
        else window.localStorage.removeItem(tokenKey());
      } catch {
        /* ignore */
      }
    }
  }, []);

  const setTarget = React.useCallback((t: ApiTarget) => {
    setTargetState(t);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(targetKey(), t.name);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const value = React.useMemo<SessionCtx>(
    () => ({
      client,
      target,
      token,
      setToken,
      setTarget,
      availableTargets: apiTargets(),
      isLocked: isLocked(),
      deployEnv: deployEnv(),
      onUnauthorized,
    }),
    [client, target, token, setToken, setTarget, onUnauthorized],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useSession must be used inside <SessionProvider>");
  return c;
}
