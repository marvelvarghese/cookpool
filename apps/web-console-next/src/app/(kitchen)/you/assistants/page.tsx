"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { AssistantsScreen } from "@/components/kitchen/assistants-ui";

/**
 * You → Connected assistants (cookpool-mcp MC-4, design §3): the connector
 * URL, how to add it, the assistants connected and Disconnect. It exists
 * only in the new frame: today's visitor is sent to You.
 */
export default function AssistantsPage() {
  const shows = useNewFrameOnly("/you/assistants");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <AssistantsScreen />;
}
