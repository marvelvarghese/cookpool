"use client";

import * as React from "react";
import type { ReachableItem } from "@saas/contracts/kitchen";
import { useToast } from "@/components/ui/toast";
import { useReadSentence } from "./say-it-data";
import { sayItError, sentenceToSend } from "./say-it";
import { saidTicks } from "./kitchen-staples";
import { withPicks } from "./kitchen-picks";
import type { TickState } from "./tick-row";

/**
 * Say it in the Kitchen's search (cookpool-revamp RV-21, the canvas's
 * RvKitchenB): the ✦ inside the field turns it into "Say what you used", and
 * Enter sends the sentence to the same read as Say it's sheet (AI-7,
 * `POST /v1/kitchen/me/ai/uses`, which writes nothing). Each line it reads
 * TICKS the row it names with the amount said — the unit it was said in and
 * the number — instead of logging; the Log button then logs them as every
 * pick is logged (for you alone). Rows that must ask first are left alone.
 */

export const SAY_NO_MATCH = "Couldn’t match that · try “2 eggs and milk”";

export function useSayIntoTicks(o: {
  rows: ReadonlyMap<string, { item: ReachableItem; pickable: boolean }>;
  setBox: (id: string, box: TickState) => void;
  setPicked: (update: (p: ReadonlySet<string>) => Set<string>) => void;
}) {
  const read = useReadSentence();
  const { toast } = useToast();
  const [reading, setReading] = React.useState(false);
  const ref = React.useRef(o);
  ref.current = o;
  const go = React.useCallback(
    async (text: string): Promise<boolean> => {
      const sentence = sentenceToSend(text);
      if (!sentence) return false;
      setReading(true);
      const r = await read(sentence);
      setReading(false);
      if (!r.ok) {
        toast({ kind: "error", title: sayItError(r.error, r.status).title });
        return false;
      }
      const ticks = saidTicks(r.data, ref.current.rows);
      if (ticks.length === 0) {
        toast({ kind: "default", title: SAY_NO_MATCH });
        return false;
      }
      for (const t of ticks) ref.current.setBox(t.id, t.box);
      ref.current.setPicked((p) => withPicks(p, ticks.map((t) => t.id)));
      return true;
    },
    [read, toast],
  );
  return { go, reading };
}
