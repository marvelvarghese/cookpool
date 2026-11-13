"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SplitecoExpenseSummary, SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { Avatar, BackButton, CategoryIcon, Loading, Screen, Sheet, useLoad, useQueryParam } from "@/components/ui";
import { BucketLine } from "@/components/bucket-line";
import { RemindButton } from "@/components/remind";
import { SwipeRow } from "@saas/gestures/react/swipe-row";
import { usePager } from "@saas/gestures/react/pager";
import { usePull } from "@saas/gestures/react/pull";
import { formatShort } from "@/lib/money";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { namesFrom, nameOf, type Names } from "@/lib/people";
import { groupTint } from "@/lib/groups";
import { signedShort } from "@/lib/home";
import { UNDO_MS } from "@/lib/delayed";
import { RideProof } from "@/components/ride-proof";
import { rideOf } from "@/lib/ride-view";
import { BillDeletes, billMeta, billMonths, billShare, billWritable, holdHref, holdTiles, planRows, planTitle, type HoldTile } from "@/lib/group-view";
import { useMe } from "@/lib/me";

interface ToastValue {
  text: string;
  undo?: () => void;
}

/**
 * A group (V2Group, spliteco-calm SL3, design §3): tile, name, faces and
 * your net; Bills · Balances as a segment that is also a two-page pager.
 * A bill swipes left to Delete (with a real Undo: the request waits behind
 * the toast), holding it opens Edit · Move · Comment, tapping opens it. One
 * main action: the Add pill. From the left edge is back, never the pager.
 */
export default function GroupPage() {
  const id = useQueryParam("id");
  const load = useLoad((c) => (id ? c.spliteco.group(id) : new Promise<never>(() => undefined)), [id]);
  const [invite, setInvite] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  const { me } = useMe();
  const g = load.data?.group;
  return (
    <Screen nav={false}>
      <header className="hdr">
        <BackButton href="/groups" label="Back to groups" />
        {load.data && g ? (
          <div className="hdr-actions">
            <Link href={`/share?group=${encodeURIComponent(g.id)}`} className="iconbtn" aria-label="Share or export">
              <Icon name="share" size={18} />
            </Link>
            <button className="iconbtn" aria-label="Group settings" onClick={() => setSettings(true)}>
              <Icon name="more" size={18} />
            </button>
          </div>
        ) : null}
      </header>
      {id ? <Loading load={load}>{load.data ? <Group data={load.data} me={me?.id ?? null} reload={load.reload} /> : null}</Loading> : null}
      {load.data && g ? (
        <Link href={`/add?group=${encodeURIComponent(g.id)}`} className="add-pill">
          <Icon name="plus" size={20} stroke={2.2} />
          Add
        </Link>
      ) : null}
      {invite && id ? <Invite groupId={id} name={g?.name ?? "the group"} onClose={() => setInvite(false)} /> : null}
      {settings && load.data ? (
        <Settings
          data={load.data}
          onClose={() => setSettings(false)}
          onChanged={load.reload}
          onInvite={() => {
            setSettings(false);
            setInvite(true);
          }}
        />
      ) : null}
    </Screen>
  );
}

function Group({ data, me, reload }: { data: SplitecoGroupResponse; me: string | null; reload: () => Promise<void> }) {
  const g = data.group;
  const names = namesFrom(data.members, data.people);
  const tint = groupTint(g);
  const net = signedShort(g.myBalanceMinor, g.currency);
  const [page, setPage] = React.useState(0);
  const pager = usePager({ index: page, count: 2, onChange: setPage, leaveEdge: true });
  const pull = usePull(() => reload());

  // The pull's twin: the group re-reads when it comes back into view.
  React.useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [reload]);

  // ── The toast ──
  const [toast, setToast] = React.useState<(ToastValue & { id: number }) | null>(null);
  const show = React.useCallback((t: ToastValue | null) => setToast(t ? { ...t, id: Date.now() } : null), []);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((now) => (now?.id === toast.id ? null : now)), toast.undo ? UNDO_MS : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Delete, delayed behind the toast so Undo is real ──
  const { client } = useSession();
  const live = React.useRef(true);
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(new Set());
  const latest = React.useRef({ reload, show });
  React.useEffect(() => {
    latest.current = { reload, show };
  }, [reload, show]);
  const deletes = React.useMemo(
    () =>
      new BillDeletes((id) => client.spliteco.deleteExpense(id, { idempotencyKey: newIdempotencyKey() }), {
        change: (h) => {
          if (live.current) setHidden(h);
        },
        deleted: () => {
          if (live.current) void latest.current.reload();
        },
        failed: (_id, err) => {
          if (live.current) latest.current.show({ text: `Not deleted · ${errorText(err)}` });
        },
      }),
    [client],
  );
  React.useEffect(() => {
    live.current = true;
    const leave = () => deletes.flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      deletes.flush();
      live.current = false;
    };
  }, [deletes]);

  const remove = React.useCallback(
    (e: SplitecoExpenseSummary) => {
      if (!deletes.remove(e.id)) return;
      show({
        text: "Deleted",
        undo: () => {
          deletes.undo(e.id);
          show(null);
        },
      });
    },
    [deletes, show],
  );

  const [held, setHeld] = React.useState<SplitecoExpenseSummary | null>(null);
  const position = Math.max(0, Math.min(1, pager.position));
  const tabs = ["Bills", "Balances"] as const;

  return (
    <>
      <div style={{ position: "relative" }}>
        <div ref={pull.spinner} className={`pull-spinner ${pull.refreshing ? "spinning" : ""}`} aria-hidden="true">
          <span />
        </div>
        <div ref={pull.surface} className="pull-surface stack" style={{ gap: 18 }}>
          <section className="ghead" aria-label="The group">
            <div className="gt" style={{ background: tint.bg, color: tint.fg }}>
              <Icon name={g.kind} size={26} />
            </div>
            <div className="who">
              <h1>{g.kind === "direct" ? "Outside groups" : g.name}</h1>
              <span className="faces" aria-label={`${data.members.length} ${data.members.length === 1 ? "person" : "people"}`}>
                {data.members.slice(0, 5).map((m) => (
                  <Avatar key={m.subjectId} id={m.subjectId} name={nameOf(names, m.subjectId, me)} me={me} size={22} />
                ))}
              </span>
            </div>
            <span className={`gnet ${net.tone}`} aria-label={g.myBalanceMinor > 0 ? `You get back ${net.text}` : g.myBalanceMinor < 0 ? `You owe ${net.text}` : "All square"}>
              {g.myBalanceMinor === 0 ? "settled" : net.text}
            </span>
          </section>
          {g.myBuckets ? (
            <p className="gsub">
              <BucketLine myBuckets={g.myBuckets} currency={g.currency} />
            </p>
          ) : null}

          <div role="tablist" aria-label="Bills or balances" className={`seg2 ${pager.dragging ? "dragging" : ""}`} style={{ "--seg": position } as React.CSSProperties}>
            <span className="knob" aria-hidden="true" />
            {tabs.map((t, i) => (
              <button key={t} type="button" role="tab" aria-selected={Math.round(position) === i} aria-controls={`gpage-${i}`} onClick={() => setPage(i)}>
                {t}
              </button>
            ))}
          </div>

          <div ref={pager.viewport} className="pager gpager">
            <div ref={pager.track} className="pager-track gpages">
              <section id="gpage-0" role="tabpanel" aria-label="Bills" className="gpage" aria-hidden={page !== 0 ? "true" : undefined} inert={page !== 0}>
                <Bills data={data} names={names} me={me} hidden={hidden} onDelete={remove} onHold={setHeld} />
              </section>
              <section id="gpage-1" role="tabpanel" aria-label="Balances" className="gpage" aria-hidden={page !== 1 ? "true" : undefined} inert={page !== 1}>
                <Balances data={data} names={names} me={me} reload={reload} />
              </section>
            </div>
          </div>
        </div>
      </div>

      {held ? <HoldSheet e={held} canWrite={data.canWrite} onClose={() => setHeld(null)} /> : null}
      {toast ? (
        <div className={`toast ${toast.undo ? "undoable" : ""}`} role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" className="undo" onClick={toast.undo}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Bills({
  data,
  names,
  me,
  hidden,
  onDelete,
  onHold,
}: {
  data: SplitecoGroupResponse;
  names: Names;
  me: string | null;
  hidden: ReadonlySet<string>;
  onDelete: (e: SplitecoExpenseSummary) => void;
  onHold: (e: SplitecoExpenseSummary) => void;
}) {
  if (data.expenses.length === 0) return <p className="empty">No bills yet. Add the first one.</p>;
  return (
    <>
      {billMonths(data.expenses).map(([month, rows]) =>
        rows.every((e) => hidden.has(e.id)) ? null : (
          <React.Fragment key={month}>
            <span className="month">{month}</span>
            <div className="card flush">
              {rows.map((e) => (
                <div key={e.id} className={`bill-slot ${hidden.has(e.id) ? "gone" : ""}`} aria-hidden={hidden.has(e.id) ? "true" : undefined}>
                  {hidden.has(e.id) ? null : <BillRow e={e} names={names} me={me} canWrite={data.canWrite} onDelete={onDelete} onHold={onHold} />}
                </div>
              ))}
            </div>
          </React.Fragment>
        ),
      )}
    </>
  );
}

function BillRow({
  e,
  names,
  me,
  canWrite,
  onDelete,
  onHold,
}: {
  e: SplitecoExpenseSummary;
  names: Names;
  me: string | null;
  canWrite: boolean;
  onDelete: (e: SplitecoExpenseSummary) => void;
  onHold: (e: SplitecoExpenseSummary) => void;
}) {
  const writable = billWritable(e, canWrite);
  const share = billShare(e, me);
  const meta = billMeta(e, names, me);
  return (
    <SwipeRow
      action={
        writable ? (
          <button type="button" className="del" onClick={() => onDelete(e)} aria-label={`Delete ${e.title}`}>
            <Icon name="trash" size={20} />
          </button>
        ) : null
      }
      actionTone="red"
      onFire={writable ? () => onDelete(e) : undefined}
      onHold={() => onHold(e)}
    >
      <Link href={`/expense?id=${encodeURIComponent(e.id)}`} className="brow" aria-label={`${e.title}, ${meta}, ${share.label === "not involved" ? "not involved" : `${share.label} ${share.text}`}`}>
        <CategoryIcon expense={e} size={38} />
        <span className="main">
          <span className="title">{e.title}</span>
          <span className="sub">
            {rideOf(e) ? (
              <span style={{ display: "inline-flex", verticalAlign: "-2px", marginRight: 4 }} aria-label="Locked: change it in Tripeco">
                <Icon name="lock" size={12} />
              </span>
            ) : null}
            {meta}
          </span>
        </span>
        <span className={`amt ${share.label === "not involved" ? "none" : share.tone}`}>{share.text}</span>
      </Link>
    </SwipeRow>
  );
}

const TILE: Record<HoldTile, { label: string; icon: string; cls: string }> = {
  edit: { label: "Edit", icon: "edit", cls: "i-edit" },
  move: { label: "Move", icon: "move", cls: "i-move" },
  comment: { label: "Comment", icon: "comment", cls: "i-comment" },
  open: { label: "Open", icon: "chevron", cls: "i-edit" },
  ride: { label: "Open", icon: "chevron", cls: "i-edit" },
};

function HoldSheet({ e, canWrite, onClose }: { e: SplitecoExpenseSummary; canWrite: boolean; onClose: () => void }) {
  const tiles = holdTiles(e, canWrite);
  const router = useRouter();
  const { me } = useMe();
  const ride = rideOf(e);
  if (ride) {
    return (
      <Sheet label={e.title} onClose={onClose}>
        <div className="sheet-bill">
          <CategoryIcon expense={e} size={40} />
          <span className="name">{e.title}</span>
          <span className="amt">{formatShort(e.totalMinor, e.currency)}</span>
        </div>
        <RideProof rideId={ride} me={me?.id ?? null} onComment={() => router.push(holdHref("comment", e.id))} />
      </Sheet>
    );
  }
  return (
    <Sheet label={e.title} onClose={onClose}>
      <div className="sheet-bill">
        <CategoryIcon expense={e} size={40} />
        <span className="name">{e.title}</span>
        <span className="amt">{formatShort(e.totalMinor, e.currency)}</span>
      </div>
      <div className="atiles" style={tiles.length === 2 ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : undefined}>
        {tiles.map((t) => (
          <Link key={t} href={holdHref(t, e.id)} className="atile">
            <span className={TILE[t].cls} style={{ display: "inline-flex" }}>
              <Icon name={TILE[t].icon} size={20} />
            </span>
            {TILE[t].label}
          </Link>
        ))}
      </div>
    </Sheet>
  );
}

function Balances({ data, names, me, reload }: { data: SplitecoGroupResponse; names: Names; me: string | null; reload: () => Promise<void> }) {
  const g = data.group;
  const rows = planRows(data, names, me);
  return (
    <>
      <span className="month">{planTitle(data.settings.simplifyDebts)}</span>
      {rows.length === 0 ? (
        <p className="empty">Everyone is settled up.</p>
      ) : (
        <div className="card flush">
          {rows.map((p) => {
            const inner = (
              <>
                <span className="p">{p.from}</span>
                <Icon name="move" size={18} />
                <span className="p to">{p.to}</span>
                {p.toId === me && data.canWrite ? (
                  <RemindButton
                    compact
                    onSent={() => void reload()}
                    target={{
                      to: p.fromId,
                      toName: p.from,
                      amountMinor: p.amountMinor,
                      currency: g.currency,
                      groupId: g.id,
                      groupName: g.kind === "direct" ? null : g.name,
                      lastSentAt: data.reminded.find((r) => r.subjectId === p.fromId)?.sentAt ?? null,
                    }}
                  />
                ) : null}
                <span className="amt">{formatShort(p.amountMinor, g.currency)}</span>
              </>
            );
            const key = `${p.fromId}>${p.toId}`;
            return p.fromId === me && data.canWrite ? (
              <Link key={key} href={`/settle?group=${encodeURIComponent(g.id)}&to=${encodeURIComponent(p.toId)}`} className="plan-row" aria-label={`You pay ${p.to} ${formatShort(p.amountMinor, g.currency)}`}>
                {inner}
              </Link>
            ) : (
              <div key={key} className="plan-row" aria-label={`${p.from} pays ${p.to} ${formatShort(p.amountMinor, g.currency)}`}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
      {data.canWrite ? (
        <Link href={`/settle?group=${encodeURIComponent(g.id)}`} className="settle-up">
          Settle up
        </Link>
      ) : (
        <span className="settle-up" aria-disabled="true" title="Viewers can't record payments">
          Settle up
        </span>
      )}
    </>
  );
}

function Invite({ groupId, name, onClose }: { groupId: string; name: string; onClose: () => void }) {
  const { client } = useSession();
  const [code, setCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    client.memberships.getJoinCode(groupId).then(
      (r) => setCode(r.code),
      (err: unknown) => setError(errorText(err)),
    );
  }, [client, groupId]);
  async function copy() {
    if (!code) return;
    const text = `Join ${name} on Spliteco with the code ${code} — ${window.location.origin}/groups`;
    try {
      if (navigator.share) await navigator.share({ title: `Join ${name}`, text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* cancelled */
    }
  }
  return (
    <Sheet label="Invite people" onClose={onClose}>
      <h2 className="h1" style={{ fontSize: 22 }}>Invite to {name}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>Groups → Join, in Spliteco or Cookpool.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {code ? (
        <div className="panel" style={{ alignItems: "center" }}>
          <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: "0.25em" }} className="money">{code}</span>
        </div>
      ) : !error ? (
        <p className="spinner" role="status">Getting the code…</p>
      ) : null}
      <button className="btn big" onClick={copy} disabled={!code}>
        {copied ? "Shared" : "Share the code"}
      </button>
    </Sheet>
  );
}

function Settings({ data, onClose, onChanged, onInvite }: { data: SplitecoGroupResponse; onClose: () => void; onChanged: () => void; onInvite: () => void }) {
  const { client } = useSession();
  const router = useRouter();
  const [on, setOn] = React.useState(data.settings.simplifyDebts);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const g = data.group;
  async function flip() {
    const next = !on;
    setBusy(true);
    setError(null);
    try {
      const r = await client.spliteco.setGroupSettings(g.id, { simplifyDebts: next });
      setOn(r.settings.simplifyDebts);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet label="Group settings" onClose={onClose}>
      <h2 className="h1" style={{ fontSize: 22 }}>{g.kind === "direct" ? "Outside groups" : g.name}</h2>
      <div className="atiles" style={{ gridTemplateColumns: g.kind !== "direct" ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" }}>
        {g.kind !== "direct" ? (
          <button type="button" className="atile" onClick={onInvite}>
            <Icon name="invite" size={20} />
            Invite
          </button>
        ) : null}
        <button type="button" className="atile" onClick={() => router.push(`/insights?group=${encodeURIComponent(g.id)}`)}>
          <Icon name="pie" size={20} />
          Totals
        </button>
      </div>
      <div className="row-between" style={{ minHeight: 56, gap: 12 }}>
        <span className="stack" style={{ gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }} id="simplify-label">Simplify debts</span>
          <span className="small dim">{on ? "Fewest payments" : "Pair by pair"}</span>
        </span>
        <button className="switch" role="switch" aria-checked={on} aria-labelledby="simplify-label" disabled={busy || !data.canWrite} onClick={flip}>
          <span />
        </button>
      </div>
      {g.madeIn === "cookpool" ? <p className="note">Kitchen and Other simplify each on its own.</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </Sheet>
  );
}
