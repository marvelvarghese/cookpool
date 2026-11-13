"use client";

// All rides, newest first (Home's "All").

import { RideRow } from "@/components/tabs/home-tab";
import { Loading, Screen, SignedIn, useLoad } from "@/components/ui";

export default function RidesPage() {
  return (
    <SignedIn>
      <Rides />
    </SignedIn>
  );
}

function Rides() {
  const load = useLoad((c) => c.tripeco.rides(), []);
  return (
    <Screen back="/" title="Rides">
      <Loading load={load}>
        {load.data ? (
          <div className="card rows">
            {load.data.rides.map((r) => (
              <RideRow key={r.id} ride={r} />
            ))}
            {load.data.rides.length === 0 ? <div className="row"><span className="muted">No rides yet</span></div> : null}
          </div>
        ) : null}
      </Loading>
    </Screen>
  );
}
