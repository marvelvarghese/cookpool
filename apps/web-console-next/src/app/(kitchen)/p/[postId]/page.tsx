"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { PostScreen } from "@/components/kitchen/community-post-ui";

/**
 * A post (CM-6): the post, Yum with names, comments and the comment box. It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/p/:postId");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <PostScreen />;
}
