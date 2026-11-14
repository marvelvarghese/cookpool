"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { MoneyNative } from "@/components/kitchen/money-native-ui";

/**
 * Money (cookpool-recipes RC-2; native since money-native MY-8): the new
 * frame's tab is the shared Money pages in Cookpool's own look
 * (`MoneyNative`), reading and writing through this app's client. It exists
 * only in the new frame: a prod visitor is sent Home.
 */
export default function MoneyPage() {
  const shows = useNewFrameOnly("/money");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <MoneyNative />;
}
