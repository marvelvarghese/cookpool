"use client";

// The signed-in session (tripeco TR-5), as Spliteco's: a bearer token in
// localStorage (`tripeco.token`) and an SDK client that sends it to
// `<origin>/api` (the Worker forwards `/api/*` to api-edge). The same account
// as Spliteco and Cookpool. A 401 to a request that carried the token ends the
// session: the token is dropped and the app goes to Sign in.

import * as React from "react";
import { Cookpool, CookpoolError } from "@saas/sdk";

export const TOKEN_KEY = "tripeco.token";

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
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) window.location.replace("/sign-in");
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

/** One plain line for an error; the API's reason when we have words for it. */
export function errorText(err: unknown): string {
  if (err instanceof CookpoolError) {
    const reason = err.details?.["reason"];
    if (typeof reason === "string" && REASON_COPY[reason]) return REASON_COPY[reason]!;
    if (err.status === 0) return "Can't reach Tripeco";
    return err.message || "Something went wrong";
  }
  return "Can't reach Tripeco";
}

export function errorReason(err: unknown): string | null {
  return err instanceof CookpoolError && typeof err.details?.["reason"] === "string" ? (err.details["reason"] as string) : null;
}

// One line each (design §0.11).
export const REASON_COPY: Record<string, string> = {
  ride_not_done: "Add the end reading first",
  no_riders: "Nobody owes anything",
  no_group: "Pick a group",
  solo_drive: "Only you rode",
  ride_posted: "Undo the post first",
  ride_not_posted: "Not posted",
  vehicle_archived: "That vehicle was removed",
  not_in_group: "Someone isn't in that group",
  currency_mismatch: "That group counts in another currency",
  owned_by_tripeco: "Change it in Tripeco",
  receipt_daily_limit: "Today's photo reads are used up — type it",
  ai_daily_limit: "Today's photo reads are used up — type it",
  ai_unavailable: "Photo reading is off — type it",
  ai_failed: "Couldn't read that — type it",
  handoff_expired: "That sign-in link expired",
  handoff_used: "That sign-in link was already used",
  handoff_invalid: "That sign-in link isn't valid",
  handoff_wrong_origin: "That sign-in link was for another app",
};

/** A key per user action: kept across retries of the same press. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`;
}
