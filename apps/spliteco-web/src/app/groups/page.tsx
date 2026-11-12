"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SPLITECO_CREATE_KINDS, type SplitecoCreateKind, type SplitecoGroupSummary, type SplitecoGroupsResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { Avatar, Loading, Screen, Sheet, useLoad, useQueryParam } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { KIND_LABELS, friendLine, friendWhere } from "@/lib/view";
import { groupTint, planLines } from "@/lib/groups";
import { BucketLine } from "@/components/bucket-line";

export default function GroupsPage() {
  const load = useLoad((c) => c.spliteco.groups(), []);
  const tabParam = useQueryParam("tab");
  const [tab, setTab] = React.useState<"groups" | "friends">("groups");
  React.useEffect(() => {
    if (tabParam === "friends") setTab("friends");
  }, [tabParam]);
  const [sheet, setSheet] = React.useState<"create" | "join" | null>(null);
  const [query, setQuery] = React.useState("");
  const [showSettled, setShowSettled] = React.useState(false);
  const { me } = useMe();

  return (
    <Screen tight>
      <header className="hdr">
        <h1 className="h1">Groups</h1>
        <div className="inline">
          <button className="pillbtn" aria-label="Join a group with a code" onClick={() => setSheet("join")}>
            <Icon name="key" size={18} />
            Join
          </button>
          <button className="iconbtn" aria-label="Create a group" style={{ background: "var(--cobalt)", border: 0, color: "#fff" }} onClick={() => setSheet("create")}>
            <Icon name="plus" size={22} stroke={2.2} />
          </button>
        </div>
      </header>
      <label className="field">
        <Icon name="search" />
        <span className="sr">Search groups and friends</span>
        <input type="search" placeholder="Search groups and friends" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Loading load={load}>
        {load.data ? (
          <Lists
            data={load.data}
            tab={tab}
            setTab={setTab}
            query={query.trim().toLowerCase()}
            showSettled={showSettled}
            setShowSettled={setShowSettled}
            me={me?.id ?? null}
          />
        ) : null}
      </Loading>
      {sheet === "create" ? <CreateGroup onClose={() => setSheet(null)} /> : null}
      {sheet === "join" ? <JoinGroup onClose={() => setSheet(null)} /> : null}
    </Screen>
  );
}

function Lists(props: {
  data: SplitecoGroupsResponse;
  tab: "groups" | "friends";
  setTab: (t: "groups" | "friends") => void;
  query: string;
  showSettled: boolean;
  setShowSettled: (v: boolean) => void;
  me: string | null;
}) {
  const { data, tab, query } = props;
  const names = new Map(data.friends.map((f) => [f.subjectId, f.name ?? "Someone"]));
  const groups = data.groups.filter((g) => !query || g.name.toLowerCase().includes(query));
  const open = groups.filter((g) => g.myBalanceMinor !== 0 || g.myPlan.length > 0);
  const settled = groups.filter((g) => !open.includes(g));
  const friends = data.friends.filter((f) => !query || (f.name ?? "").toLowerCase().includes(query));
  const inr = data.groups.filter((g) => g.currency === "INR").reduce((s, g) => s + g.myBalanceMinor, 0);

  return (
    <>
      <div role="tablist" aria-label="Show" className="seg">
        <button role="tab" aria-selected={tab === "groups"} onClick={() => props.setTab("groups")}>
          Groups · {data.groups.length}
        </button>
        <button role="tab" aria-selected={tab === "friends"} onClick={() => props.setTab("friends")}>
          Friends · {data.friends.length}
        </button>
      </div>
      <div className="small muted" style={{ fontSize: 13 }}>
        {inr > 0 ? (
          <span>Overall, you get back <b className="get">{formatMoney(inr)}</b></span>
        ) : inr < 0 ? (
          <span>Overall, you owe <b className="owe">{formatMoney(-inr)}</b></span>
        ) : (
          <span>You&apos;re all square across your groups</span>
        )}
      </div>
      {tab === "groups" ? (
        <div className="stack">
          {groups.length === 0 ? <p className="empty">No groups yet. Make one with +, or join with a code.</p> : null}
          {open.map((g) => <GroupCard key={g.id} g={g} names={names} />)}
          {data.groups.some((g) => g.madeIn === "cookpool") ? (
            <p className="note" style={{ padding: "2px 4px" }}>
              Every Cookpool kitchen you&apos;re in shows up here by itself. Groups you create in Spliteco stay in Spliteco — Cookpool never sees them.
            </p>
          ) : null}
          {props.showSettled || query ? settled.map((g) => <GroupCard key={g.id} g={g} names={names} />) : null}
          {settled.length > 0 && !props.showSettled && !query ? (
            <button className="dashed" onClick={() => props.setShowSettled(true)}>
              Show {settled.length} settled-up group{settled.length === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="list">
          {friends.length === 0 ? <p className="empty">People you share a group with show up here.</p> : null}
          {friends.map((f) => {
            const line = friendLine(f);
            const name = f.name ?? "Someone";
            return (
              <Link key={f.subjectId} href={`/friend?id=${encodeURIComponent(f.subjectId)}`} className="lrow">
                <Avatar id={f.subjectId} name={name} me={props.me} size={42} />
                <div className="main">
                  <span className="title">{name}</span>
                  <span className="sub ellipsis">{friendWhere(f)}</span>
                </div>
                <div className="end">
                  <span className="k">{line.label}</span>
                  <span className={`v ${line.tone}`}>{line.amount}</span>
                </div>
              </Link>
            );
          })}
          <p className="note" style={{ marginTop: 12 }}>
            To add a friend, invite them into a group from the group&apos;s Invite button.
          </p>
        </div>
      )}
    </>
  );
}

function GroupCard({ g, names }: { g: SplitecoGroupSummary; names: Map<string, string> }) {
  const tint = groupTint(g);
  const cook = g.madeIn === "cookpool";
  const n = g.myBalanceMinor;
  const lines = planLines(g, names);
  return (
    <Link href={`/group?id=${encodeURIComponent(g.id)}`} className={`gcard ${cook ? "" : ""}`}>
      <div className="gicon" style={{ background: tint.bg, color: tint.fg }}>
        <Icon name={g.kind} size={24} />
      </div>
      <div className="stack" style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <div className="row-between">
          <span className="ellipsis" style={{ fontSize: 16, fontWeight: 500 }}>{g.name}</span>
          <span className={n > 0 ? "get" : n < 0 ? "owe" : "even"} style={{ fontSize: 15, fontWeight: 500, flex: "none" }}>
            {n === 0 ? "settled" : formatMoney(n, g.currency, { sign: true })}
          </span>
        </div>
        <div className="inline small dim" style={{ gap: 6 }}>
          <span>
            {KIND_LABELS[g.kind]} · {g.memberCount} {g.memberCount === 1 ? "person" : "people"}
            {n > 0 ? " · you get back" : n < 0 ? " · you owe" : ""}
          </span>
          {cook ? <span className="cookpool-tag">From Cookpool</span> : null}
        </div>
        <BucketLine myBuckets={g.myBuckets} currency={g.currency} size={12} />
        {lines.length > 0 ? (
          <div className="stack" style={{ gap: 0, paddingTop: 4 }}>
            {lines.slice(0, 2).map((l) => (
              <span key={l} className="small muted">{l}</span>
            ))}
          </div>
        ) : n === 0 ? (
          <span className="small muted" style={{ paddingTop: 4 }}>Nothing owed</span>
        ) : null}
      </div>
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
      router.push(`/group?id=${encodeURIComponent(r.group.id)}`);
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
      router.push(`/group?id=${encodeURIComponent(r.orgId)}`);
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
