"use client";

// One ride being edited (New ride and Split share it, tripeco TR-6): the
// ride, its group's people, a draft the screen edits, the numbers worked out
// from it as the person types, and a save that waits 500 ms after the last
// change (and runs at once before posting or leaving).

import * as React from "react";
import type { SplitecoGroupResponse, TripecoRide } from "@saas/sdk";
import { useSession, errorText, newIdempotencyKey } from "./session";
import { useMe } from "./me";
import { draftOf, patchOf, work, type Draft } from "./ride-draft";

export interface RideEditor {
  ride: TripecoRide | null;
  group: SplitecoGroupResponse | null;
  draft: Draft | null;
  error: string | null;
  owner: string;
  worked: ReturnType<typeof work> | null;
  change(update: (d: Draft) => Draft): void;
  /** Save now (before posting or leaving). */
  flush(): Promise<TripecoRide | null>;
  post(): Promise<TripecoRide | null>;
  /** Choose a group: its people come in, all on, the first time. */
  pickGroup(groupId: string | null): Promise<void>;
}

export function useRide(id: string | null): RideEditor {
  const { client } = useSession();
  const { me } = useMe();
  const [ride, setRide] = React.useState<TripecoRide | null>(null);
  const [group, setGroup] = React.useState<SplitecoGroupResponse | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef<Draft | null>(null);
  const dirty = React.useRef(false);

  const names = React.useCallback(
    (g: SplitecoGroupResponse | null): Map<string, string> => {
      const m = new Map<string, string>();
      for (const p of g?.members ?? []) m.set(p.subjectId, p.subjectId === me?.id ? "You" : (p.name ?? "Someone"));
      if (me) m.set(me.id, "You");
      return m;
    },
    [me],
  );

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    void (async () => {
      try {
        const { ride: r } = await client.tripeco.ride(id);
        const g = r.groupId ? await client.spliteco.group(r.groupId).catch(() => null) : null;
        if (!live) return;
        setRide(r);
        setGroup(g);
        const d = draftOf(r, names(g));
        latest.current = d;
        setDraft(d);
      } catch (err) {
        if (live) setError(errorText(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [client, id, names]);

  const save = React.useCallback(async (): Promise<TripecoRide | null> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const d = latest.current;
    if (!id || !d || !dirty.current) return ride;
    dirty.current = false;
    try {
      const { ride: r } = await client.tripeco.updateRide(id, patchOf(d));
      setRide(r);
      setError(null);
      return r;
    } catch (err) {
      setError(errorText(err));
      return null;
    }
  }, [client, id, ride]);

  const change = React.useCallback(
    (update: (d: Draft) => Draft) => {
      setDraft((d) => {
        if (!d) return d;
        const next = update(d);
        latest.current = next;
        return next;
      });
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 500);
    },
    [save],
  );

  // Leaving saves what is waiting.
  React.useEffect(() => {
    const leave = () => void save();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      if (dirty.current) void save();
    };
  }, [save]);

  const pickGroup = React.useCallback(
    async (groupId: string | null) => {
      const g = groupId ? await client.spliteco.group(groupId).catch(() => null) : null;
      setGroup(g);
      const n = names(g);
      change((d) => {
        const have = new Set(d.riders.map((r) => r.subjectId));
        const onlyOwner = d.riders.filter((r) => r.on).length <= 1;
        const added = (g?.members ?? []).filter((m) => !have.has(m.subjectId)).map((m) => ({ subjectId: m.subjectId, name: n.get(m.subjectId) ?? "Someone", on: onlyOwner, km: null }));
        // People outside the new group can't be on it.
        const inGroup = new Set((g?.members ?? []).map((m) => m.subjectId));
        const kept = d.riders.filter((r) => r.subjectId === me?.id || inGroup.has(r.subjectId)).map((r) => ({ ...r, name: n.get(r.subjectId) ?? r.name }));
        return { ...d, groupId, riders: [...kept, ...added] };
      });
    },
    [client, change, names, me],
  );

  const post = React.useCallback(async (): Promise<TripecoRide | null> => {
    const saved = await save();
    if (!id || (!saved && error)) return null;
    try {
      const { ride: r } = await client.tripeco.postRide(id, {}, { idempotencyKey: newIdempotencyKey() });
      setRide(r);
      return r;
    } catch (err) {
      setError(errorText(err));
      return null;
    }
  }, [client, id, save, error]);

  const owner = me?.id ?? ride?.riders[0]?.subjectId ?? "";
  const worked = draft ? work(draft, owner) : null;
  return { ride, group, draft, error, owner, worked, change, flush: save, post, pickGroup };
}
