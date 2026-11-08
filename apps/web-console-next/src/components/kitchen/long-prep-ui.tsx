"use client";

import * as React from "react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { refuseIfOffline } from "@/lib/connection";
import { readLongPrep, useLongPrepMemory, writeLongPrep } from "@/lib/long-prep-store";
import { useSession } from "@/lib/session";
import { recipeLongPrep } from "./guided-steps";
import { longPrepKey, longPrepRows, markLongPrep, pingTimeText, startLongPrep } from "./long-prep";
import { LongPrepCardView } from "./guided-views";

/**
 * Long prep first, on the recipe page (cookpool-guided GC-6, design §1):
 * the amber card over this device's records. **Soak now · ping me** sets a
 * server timer (GC-3) whose push opens the recipe again, and remembers it;
 * **Already done** remembers that for a day (and cancels a timer it set).
 * The card reads again each minute, so a timer that has ended counts as done.
 */
export function LongPrepCard({ recipe, code }: { recipe: KitchenRecipe; code: string | null }) {
  const { client } = useSession();
  const memory = useLongPrepMemory();
  const [now, setNow] = React.useState(() => new Date());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const steps = recipeLongPrep(recipe);
  if (steps.length === 0) return null;
  const rows = longPrepRows(recipe.id, steps, memory, now);

  const start = async (key: string) => {
    const step = steps.find((s) => s.key === key);
    if (!step || busy || refuseIfOffline()) return;
    setBusy(key);
    setError(null);
    const r = await startLongPrep((body) => wrap(() => client.kitchen.createTimer(body)), recipe, step, new Date(), code);
    setBusy(null);
    if (r.ok) writeLongPrep(markLongPrep(readLongPrep(), recipe.id, key, r.mark));
    else if (r.message) setError(r.message);
  };

  const done = (key: string) => {
    const before = readLongPrep()[longPrepKey(recipe.id, key)];
    writeLongPrep(markLongPrep(readLongPrep(), recipe.id, key, { state: "done", at: new Date().toISOString() }));
    setError(null);
    // Its timer has nothing left to say: best effort, as a timer that already rang answers the same.
    if (before?.state === "started" && Date.parse(before.endsAt) > Date.now()) void wrap(() => client.kitchen.cancelTimer(before.timerId));
  };

  return (
    <LongPrepCardView
      rows={rows}
      busyKey={busy}
      error={error}
      endsText={(iso) => pingTimeText(iso, now)}
      onStart={(key) => void start(key)}
      onDone={done}
    />
  );
}
