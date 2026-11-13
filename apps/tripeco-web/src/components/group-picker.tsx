"use client";

// Which Spliteco group a ride goes to: your groups, one line each (design §0.2).

import * as React from "react";
import type { SplitecoGroupsResponse } from "@saas/sdk";
import { Icon } from "./icons";
import { Sheet } from "./ui";
import { useSession } from "@/lib/session";
import { initialOf } from "@/lib/people";

export function GroupPicker({ current, onPick, onClose }: { current: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
  const { client } = useSession();
  const [groups, setGroups] = React.useState<SplitecoGroupsResponse["groups"] | null>(null);
  React.useEffect(() => {
    void client.spliteco.groups().then((r) => setGroups(r.groups), () => setGroups([]));
  }, [client]);
  return (
    <Sheet label="Group" onClose={onClose}>
      <div className="card rows" style={{ background: "var(--card-2)" }}>
        {(groups ?? []).map((g) => (
          <button key={g.id} className="row" onClick={() => onPick(g.id)} aria-pressed={g.id === current}>
            <span className="tile" style={{ background: "rgba(37,99,235,.18)", color: "#93C5FD", fontSize: 15 }} aria-hidden="true">{initialOf(g.name)}</span>
            <span className="grow"><span className="t">{g.name}</span></span>
            {g.id === current ? <Icon name="check" size={18} stroke="#C6F432" /> : null}
          </button>
        ))}
        <button className="row" onClick={() => onPick(null)} aria-pressed={current === null}>
          <span className="tile" aria-hidden="true"><Icon name="car" size={18} /></span>
          <span className="grow"><span className="t">Just me</span></span>
          {current === null ? <Icon name="check" size={18} stroke="#C6F432" /> : null}
        </button>
      </div>
      {groups === null ? <p className="spinner" role="status">Loading…</p> : null}
    </Sheet>
  );
}

/** The group chip on New ride and Split: cobalt dot, name, opens the picker. */
export function GroupChip({ name, onClick }: { name: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="dot-cobalt" />
      {name}
    </>
  );
  return onClick ? (
    <button className="chip group" onClick={onClick}>{inner}</button>
  ) : (
    <span className="chip group">{inner}</span>
  );
}
