"use client";

import { useParams } from "next/navigation";
import { Screen } from "@/components/ui";
import { LiveScreen } from "@/components/live-screen";

// /live/{code}: the address a live split's QR code and invite link open.
// Signed out, it goes through Sign in and comes back here (lib/return-to.ts).

export default function LiveCodePage() {
  const params = useParams<{ code: string }>();
  const code = typeof params?.code === "string" ? params.code : "";
  return (
    <Screen nav={false}>
      <LiveScreen key={code} code={code} />
    </Screen>
  );
}
