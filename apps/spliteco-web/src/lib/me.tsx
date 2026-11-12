"use client";

// Who is signed in: their subject id (`usr_…`, the id the ledger names them
// by) and name, read once per session from the profile.

import * as React from "react";
import type { AuthUser } from "@saas/sdk";
import { useSession } from "./session";

interface MeValue {
  me: AuthUser | null;
  setMe(user: AuthUser): void;
}

const Ctx = React.createContext<MeValue>({ me: null, setMe: () => undefined });

export function MeProvider({ children }: { children: React.ReactNode }) {
  const { client, token } = useSession();
  const [me, setMe] = React.useState<AuthUser | null>(null);
  React.useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    let live = true;
    client.auth.getProfile().then(
      (r) => live && setMe(r.user),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, token]);
  return <Ctx.Provider value={{ me, setMe }}>{children}</Ctx.Provider>;
}

export function useMe(): MeValue {
  return React.useContext(Ctx);
}
