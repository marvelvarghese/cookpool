"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ConnectScreen } from "@/components/kitchen/connect-ui";

/**
 * Allow an assistant (cookpool-mcp MC-4, design §3): mcp-worker's
 * `/authorize` sends the browser to `/connect?req=<id>`. The kitchen frame
 * signs a visitor in first and brings them back here, `req` and all. It
 * exists only in the new frame: a prod visitor is sent Home.
 */
export default function ConnectPage() {
  const shows = useNewFrameOnly("/connect");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <ConnectScreen />;
}
