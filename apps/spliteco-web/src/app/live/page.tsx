"use client";

import { BackButton, Screen, useQueryParam } from "@/components/ui";
import { JoinByCode, LiveScreen } from "@/components/live-screen";

// /live?code=… opens a live split; /live alone asks for a code. Links and the
// QR code use /live/{code} (./[code]/page.tsx).

export default function LivePage() {
  const code = useQueryParam("code");
  return (
    <Screen nav={false}>
      {code ? (
        <LiveScreen code={code} />
      ) : (
        <div className="stack s14">
          <header className="hdr">
            <BackButton label="Back" href="/" />
            <div className="hdr-title"><h1>Join a live split</h1></div>
            <span style={{ width: 44 }} />
          </header>
          <section className="card">
            <p className="muted" style={{ margin: 0 }}>Type the code on the screen of whoever opened it, or scan their QR code with your camera.</p>
            <JoinByCode />
          </section>
        </div>
      )}
    </Screen>
  );
}
