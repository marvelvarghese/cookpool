"use client";

// The signed-in session: a bearer token in localStorage (`spliteco.token`),
// and an SDK client that sends it to `<origin>/api` — the same origin on every
// host (the Worker forwards `/api/*` to api-edge; `next dev` rewrites it to
// the local API). The same Cookpool account, signed in once per app (risk SE-D).
// A 401 to a request that carried the token ends the session: the token is
// dropped and the app goes to Sign in.

import * as React from "react";
import { Cookpool, CookpoolError } from "@saas/sdk";

export const TOKEN_KEY = "spliteco.token";

export function readToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts for this page */
  }
}

export function apiBase(): string {
  return typeof window === "undefined" ? "http://localhost/api" : `${window.location.origin}/api`;
}

export function makeClient(token: string | null, onUnauthorized?: () => void): Cookpool {
  const base = typeof fetch === "function" ? fetch.bind(globalThis) : undefined;
  return new Cookpool({
    baseUrl: apiBase(),
    ...(token ? { auth: { kind: "bearer" as const, token } } : {}),
    fetch: async (input, init) => {
      const response = await base!(input, init);
      if (token && onUnauthorized && response.status === 401) onUnauthorized();
      return response;
    },
  });
}

interface SessionValue {
  ready: boolean;
  token: string | null;
  client: Cookpool;
  signIn(token: string): void;
  signOut(): Promise<void>;
}

const Ctx = React.createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    setToken(readToken());
    setReady(true);
  }, []);

  const ended = React.useCallback(() => {
    writeToken(null);
    setToken(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) {
      window.location.replace("/sign-in");
    }
  }, []);

  const client = React.useMemo(() => makeClient(token, ended), [token, ended]);

  const value = React.useMemo<SessionValue>(
    () => ({
      ready,
      token,
      client,
      signIn(t) {
        writeToken(t);
        setToken(t);
      },
      async signOut() {
        try {
          await client.auth.logout();
        } catch {
          /* signed out here either way */
        }
        writeToken(null);
        setToken(null);
      },
    }),
    [ready, token, client],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useSession outside <SessionProvider>");
  return v;
}

/** An error as one plain line, with the API's reason when it has one. */
export function errorText(err: unknown): string {
  if (err instanceof CookpoolError) {
    const reason = err.details?.["reason"];
    if (typeof reason === "string" && REASON_COPY[reason]) return REASON_COPY[reason]!;
    if (err.status === 0) return "Can't reach Spliteco. Check your connection and try again.";
    return err.message || "Something went wrong. Try again.";
  }
  return "Can't reach Spliteco. Check your connection and try again.";
}

export function errorReason(err: unknown): string | null {
  if (err instanceof CookpoolError) {
    const reason = err.details?.["reason"];
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

const REASON_COPY: Record<string, string> = {
  owned_by_cookpool: "Cookpool posted this one — change it in Cookpool.",
  not_members: "Not everyone on it is a member of that group. Add them there first.",
  not_in_group: "Someone on it isn't in this group any more.",
  does_not_add_up: "The split doesn't add up to the total.",
  not_current: "This expense changed since you opened it. Open it again.",
  not_deleted: "Only a deleted expense can be restored.",
  restore_expired: "It was deleted more than 30 days ago, so it can't be restored.",
  same_group: "It's already in that group.",
  not_an_expense: "Payments and Cookpool's uses can't be changed here.",
  currency_mismatch: "This group counts in another currency.",
  no_shared_group: "You can only split with people you share a group with.",
  groups_per_person: "You're in as many groups as one person can be.",
  // SE2.
  over_settled: "That's more than you owe them here.",
  nothing_owed: "There's nothing owed between you here right now.",
  split_mismatch: "Kitchen and Other must add up to the amount.",
  not_the_payee: "Only the person paid can say it didn't arrive.",
  not_a_settlement: "Only a payment can be marked not received.",
  already_reversed: "This payment was already marked not received.",
  reminded_recently: "You reminded them in the last 24 hours. Try again tomorrow.",
  not_from_an_assistant: "Payments are recorded in the app only.",
  same_person: "A payment needs two different people.",
  // SE3: opened from Cookpool.
  handoff_expired: "That link from Cookpool has expired. Open Spliteco from Cookpool again.",
  handoff_used: "That link from Cookpool was already used. Open Spliteco from Cookpool again.",
  handoff_invalid: "That link from Cookpool isn't valid. Open Spliteco from Cookpool again.",
  handoff_wrong_origin: "That link was made for another app. Open Spliteco from Cookpool again.",
};

/** A key per user action: kept across retries of the same press. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`;
}
