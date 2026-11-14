"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SPLITECO_CREATE_KINDS, type SplitecoCreateKind, type SplitecoGroupSummary, type SplitecoGroupsResponse } from "@saas/contracts/spliteco";
import { Icon } from "../icons";
import { Avatar, Loading, Sheet, type Load } from "../ui";
import { errorText, newIdempotencyKey, useSession } from "../../lib/session";
import { KIND_LABELS } from "../../lib/view";
import { groupTint } from "../../lib/groups";
import { fromKitchen, mainBalance, signedShort } from "../../lib/home";
import { to } from "../../lib/paths";

/**
 * Groups (V2Home page 2, design §3): one line per group or friend — tile,
 * name, the Cookpool dot, the net with its sign. Search, Join and New group
 * are icons; Groups · Friends is a compact segment. What you owe whom lives
 * on the group's page.
 */
export function GroupsTab({
  load,
  me,
  friends,
  setFriends,
}: {
  load: Load<SplitecoGroupsResponse>;
  me: string | null;
  friends: boolean;
  setFriends: (v: boolean) => void;
}) {
  const [sheet, setSheet] = React.useState<"create" | "join" | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [showSettled, setShowSettled] = React.useState(false);

  return (
    <>
      <header className="hdr">
        <h1 className="h1">Groups</h1>
        <div className="hdr-actions">
          <button className="iconbtn" aria-label="Search groups and friends" aria-expanded={searching} onClick={() => setSearching((s) => !s)}>
            <Icon name="search" size={20} />
          </button>
          <button className="iconbtn" aria-label="Join a group with a code" onClick={() => setSheet("join")}>
            <Icon name="key" size={20} />
          </button>
          <button className="iconbtn" aria-label="New group" onClick={() => setSheet("create")}>
            <Icon name="plus" size={22} />
          </button>
        </div>
      </header>
      {searching || query ? (
        <label className="field">
          <Icon name="search" />
          <span className="sr">Search groups and friends</span>
          <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={searching} />
        </label>
      ) : null}
      <Loading load={load}>
        {load.data ? (
          <Lists
            data={load.data}
            friends={friends}
            setFriends={setFriends}
            query={query.trim().toLowerCase()}
            showSettled={showSettled}
            setShowSettled={setShowSettled}
            me={me}
          />
        ) : null}
      </Loading>
      {sheet === "create" ? <CreateGroup onClose={() => setSheet(null)} /> : null}
      {sheet === "join" ? <JoinGroup onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function Lists(props: {
  data: SplitecoGroupsResponse;
  friends: boolean;
  setFriends: (v: boolean) => void;
  query: string;
  showSettled: boolean;
  setShowSettled: (v: boolean) => void;
  me: string | null;
}) {
  const { data, query } = props;
  const groups = data.groups.filter((g) => !query || g.name.toLowerCase().includes(query));
  const open = groups.filter((g) => g.myBalanceMinor !== 0 || g.myPlan.length > 0);
  const settled = groups.filter((g) => !open.includes(g));
  const shown = props.showSettled || query ? [...open, ...settled] : open;
  const friends = data.friends.filter((f) => !query || (f.name ?? "").toLowerCase().includes(query));
  const anyKitchen = data.groups.some((g) => g.madeIn === "cookpool");

  return (
    <>
      <div role="tablist" aria-label="Show" className="seg compact">
        <button role="tab" aria-selected={!props.friends} onClick={() => props.setFriends(false)}>
          Groups · {data.groups.length}
        </button>
        <button role="tab" aria-selected={props.friends} onClick={() => props.setFriends(true)}>
          Friends · {data.friends.length}
        </button>
      </div>
      {!props.friends ? (
        <>
          {groups.length === 0 ? <p className="empty">No groups yet. Make one with +, or join with a code.</p> : null}
          {shown.length > 0 ? (
            <section aria-label="Groups" className="card flush">
              {shown.map((g) => (
                <GroupRow key={g.id} g={g} />
              ))}
            </section>
          ) : null}
          {settled.length > 0 && !props.showSettled && !query ? (
            <button className="dashed" onClick={() => props.setShowSettled(true)}>
              Show {settled.length} settled
            </button>
          ) : null}
        </>
      ) : friends.length === 0 ? (
        <p className="empty">People you share a group with show up here.</p>
      ) : (
        <section aria-label="Friends" className="card flush">
          {friends.map((f) => {
            const name = f.name ?? "Someone";
            const b = mainBalance(f.balances);
            const amount = b ? signedShort(b.amountMinor, b.currency) : { text: "settled", tone: "even" as const };
            return (
              <Link key={f.subjectId} href={to(`/friend?id=${encodeURIComponent(f.subjectId)}`)} className="prow">
                <Avatar id={f.subjectId} name={name} me={props.me} size={38} />
                <span className="name">{name}</span>
                {fromKitchen(f, data.groups) ? <span className="kdot" role="img" aria-label="From a Cookpool kitchen" /> : null}
                <span className={`amt ${amount.tone}`}>{amount.text}</span>
              </Link>
            );
          })}
        </section>
      )}
      {anyKitchen ? (
        <span className="legend">
          <span className="kdot" aria-hidden="true" />
          from Cookpool
        </span>
      ) : null}
    </>
  );
}

function GroupRow({ g }: { g: SplitecoGroupSummary }) {
  const tint = groupTint(g);
  const n = g.myBalanceMinor;
  const amount = n === 0 ? { text: "settled", tone: "even" as const } : signedShort(n, g.currency);
  return (
    <Link href={to(`/group?id=${encodeURIComponent(g.id)}`)} className="prow">
      <span className="gtile" style={{ background: tint.bg, color: tint.fg }} aria-hidden="true">
        <Icon name={g.kind} size={20} />
      </span>
      <span className="name">{g.name}</span>
      {g.madeIn === "cookpool" ? <span className="kdot" role="img" aria-label="Made in Cookpool" /> : null}
      <span className={`amt ${amount.tone}`}>{amount.text}</span>
    </Link>
  );
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const { client } = useSession();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<SplitecoCreateKind>("trip");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef(newIdempotencyKey());
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await client.spliteco.createGroup({ name: name.trim(), kind }, { idempotencyKey: key.current });
      router.push(to(`/group?id=${encodeURIComponent(r.group.id)}`));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <Sheet label="Create a group" onClose={onClose}>
      <form className="stack s14" onSubmit={create}>
        <h2 className="h1" style={{ fontSize: 22 }}>New group</h2>
        <label className="stack s8">
          <span className="small muted bold">Name</span>
          <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa Trip" autoFocus />
        </label>
        <div className="stack s8">
          <span className="small muted bold" id="kind-label">What kind of group</span>
          <div role="radiogroup" aria-labelledby="kind-label" className="seg inset">
            {SPLITECO_CREATE_KINDS.map((k) => (
              <button type="button" role="radio" aria-checked={kind === k} key={k} onClick={() => setKind(k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <p className="note">Only Spliteco sees groups made here. Invite people with a code once it exists.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn big" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create group"}
        </button>
      </form>
    </Sheet>
  );
}

function JoinGroup({ onClose }: { onClose: () => void }) {
  const { client } = useSession();
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef(newIdempotencyKey());
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await client.memberships.join(code.trim().toUpperCase(), { idempotencyKey: key.current });
      router.push(to(`/group?id=${encodeURIComponent(r.orgId)}`));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <Sheet label="Join a group with a code" onClose={onClose}>
      <form className="stack s14" onSubmit={join}>
        <h2 className="h1" style={{ fontSize: 22 }}>Join a group</h2>
        <label className="stack s8">
          <span className="small muted bold">The group&apos;s code</span>
          <input className="input" required maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" style={{ letterSpacing: "0.2em", fontWeight: 500 }} autoFocus />
        </label>
        <p className="note">Ask anyone in the group for its code — it&apos;s under Invite on the group.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn big" type="submit" disabled={busy || code.trim().length < 4}>
          {busy ? "Joining…" : "Join"}
        </button>
      </form>
    </Sheet>
  );
}
