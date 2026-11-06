"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider, useSession } from "@/lib/session";
import { ToastProvider } from "@/components/ui/toast";
import { CommandPaletteProvider } from "@/components/shell/command-palette";
import { TooltipProvider } from "@/components/ui/tooltip";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Stale-while-revalidate: cached data paints instantly on navigation
        // and revalidates in the background. Conservative focus refetch to
        // avoid surprise spinners. Cookpool SM-5: every write patches what it
        // changes and reads it again, so moving between tabs within a minute
        // reads nothing again; what was read stays for half an hour, so a
        // revisit paints from it instead of a skeleton.
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
        // Cookpool PW-4: a read is always tried, even when the browser says
        // it is offline, because the service worker may answer it with the
        // last data seen; only its retries wait for the network to return.
        networkMode: "offlineFirst",
      },
    },
  });
}

/**
 * Clear the query cache when the auth token changes (login/logout/token swap)
 * so a new identity never reads the previous one's cached data.
 */
function CacheResetOnAuthChange() {
  const { token } = useSession();
  const qc = React.useContext(QueryClientCtx);
  const prev = React.useRef(token);
  React.useEffect(() => {
    if (prev.current !== token) {
      prev.current = token;
      qc?.clear();
    }
  }, [token, qc]);
  return null;
}

const QueryClientCtx = React.createContext<QueryClient | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  // No config is handed down (Cookpool SM-2): the pages are static files, and
  // the browser resolves the app config from its own host on the first
  // `appConfig()` call — which the session's state initializers below make on
  // this very render, before any API client exists (src/lib/app-config.ts).

  // One QueryClient for the app lifetime (survives re-renders, not re-created).
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <QueryClientCtx.Provider value={queryClient}>
          <SessionProvider>
            <CacheResetOnAuthChange />
            <ToastProvider>
              <TooltipProvider delayDuration={200}>
                <CommandPaletteProvider>{children}</CommandPaletteProvider>
              </TooltipProvider>
            </ToastProvider>
          </SessionProvider>
        </QueryClientCtx.Provider>
      </QueryClientProvider>
    </NextThemesProvider>
  );
}
