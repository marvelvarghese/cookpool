"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SplitecoExpenseResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { Avatar, BackButton, Loading, Screen, Sheet, useLoad, useQueryParam, useToast } from "@/components/ui";
import { whoPaid } from "@/components/expense-row";
import { formatMoney, splitMoney } from "@/lib/money";
import { nameOf, namesFrom } from "@/lib/people";
import { CATEGORY_LABELS, longDate, timeAgo, viaChip } from "@/lib/activity-text";
import { METHOD_LABELS } from "@/lib/split-form";
import { historyText, myItems } from "@/lib/expense-view";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";

export default function ExpensePage() {
  const id = useQueryParam("id");
  const load = useLoad((c) => (id ? c.spliteco.expense(id) : new Promise<never>(() => undefined)), [id]);
  const { me } = useMe();
  return (
    <Screen nav={false}>
      {id ? <Loading load={load}>{load.data ? <Expense data={load.data} me={me?.id ?? null} reload={load.reload} /> : null}</Loading> : null}
    </Screen>
  );
}

function Expense({ data, me, reload }: { data: SplitecoExpenseResponse; me: string | null; reload: () => void }) {
  const { client } = useSession();
  const router = useRouter();
  const [toast, say] = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState("");
  const keys = React.useRef<Record<string, string>>({});
  const key = (k: string) => (keys.current[k] ??= newIdempotencyKey());
  const e = data.expense;
  const names = namesFrom(data.people);
  const cur = e.currency;
  const { whole, fraction } = splitMoney(e.totalMinor, cur);
  const mine = e.splits.find((s) => s.subjectId === me);
  const myShare = mine?.owedMinor ?? 0;
  const net = e.myNetMinor;
  const payer = e.payers[0];
  const writable = data.canWrite && !e.locked;
  const current = e.state === "current";
  const itemized = e.method === "items" && e.items.length > 0;
  // SE2: a payment to me that is still in effect can be marked not received.
  const paidToMe = e.kind === "settlement" && current && e.splits.some((s) => s.subjectId === me && s.owedMinor > 0);
  const [notReceived, setNotReceived] = React.useState(false);

  async function markNotReceived() {
    setBusy(true);
    setError(null);
    try {
      await client.spliteco.notReceived(e.id, { idempotencyKey: key("not-received") });
      setNotReceived(false);
      say("Marked not received — it no longer counts");
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: "delete" | "restore") {
    setBusy(true);
    setError(null);
    try {
      const r = kind === "delete"
        ? await client.spliteco.deleteExpense(e.id, { idempotencyKey: key("delete") })
        : await client.spliteco.restoreExpense(e.id, { idempotencyKey: key("restore") });
      setConfirm(false);
      say(kind === "delete" ? "Deleted — you can restore it for 30 days" : "Restored");
      if (kind === "restore") router.replace(`/expense?id=${encodeURIComponent(r.expense.id)}`);
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(ev: React.FormEvent) {
    ev.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await client.spliteco.addComment(e.id, { body: comment.trim() }, { idempotencyKey: key(`c:${comment}`) });
      setComment("");
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="hdr">
        <BackButton href={`/group?id=${encodeURIComponent(e.groupId)}`} label={`Back to ${e.groupName}`} />
        <div className="inline">
          {writable && current ? (
            <>
              <Link href={`/move?id=${encodeURIComponent(e.id)}`} className="iconbtn" aria-label="Move to another group"><Icon name="move" /></Link>
              <Link href={`/share?expense=${encodeURIComponent(e.id)}`} className="iconbtn" aria-label="Share this expense"><Icon name="share" /></Link>
              <Link href={`/add?edit=${encodeURIComponent(e.id)}`} className="iconbtn" aria-label="Edit this expense"><Icon name="edit" /></Link>
              <button className="iconbtn danger" aria-label="Delete this expense" onClick={() => setConfirm(true)}><Icon name="trash" /></button>
            </>
          ) : (
            <Link href={`/share?expense=${encodeURIComponent(e.id)}`} className="iconbtn" aria-label="Share this expense"><Icon name="share" /></Link>
          )}
        </div>
      </header>

      {e.state === "deleted" ? (
        <div className="warnbox row-between" role="status">
          <span style={{ fontSize: 14 }}>
            Deleted{e.restorableUntil ? ` · restore until ${longDate(e.restorableUntil)}` : ""}
          </span>
          {data.canWrite && e.restorableUntil && new Date(e.restorableUntil) > new Date() ? (
            <button className="btn" style={{ height: 44 }} onClick={() => act("restore")} disabled={busy}>Restore</button>
          ) : null}
        </div>
      ) : null}
      {e.state === "replaced" && e.currentId ? (
        <Link href={`/expense?id=${encodeURIComponent(e.currentId)}`} className="infobox" style={{ display: "block" }}>
          This is an older version — open the current one →
        </Link>
      ) : null}
      {e.state === "reversed" ? (
        <p className="infobox">{e.kind === "settlement" ? "Marked not received, so it no longer counts." : "This was reversed, so it no longer counts."}</p>
      ) : null}
      {paidToMe ? (
        <div className="warnbox row-between" role="note">
          <span style={{ fontSize: 14 }}>Didn&apos;t get this payment?</span>
          <button className="btn ghost" style={{ height: 44 }} onClick={() => setNotReceived(true)} disabled={busy}>Not received</button>
        </div>
      ) : null}
      {e.locked && e.kind !== "settlement" ? (
        <p className="infobox" style={{ margin: 0 }}>
          <Icon name="lock" size={14} /> Cookpool posted this. It&apos;s edited, deleted and moved in Cookpool only.
        </p>
      ) : null}

      <section className="stack" style={{ gap: 6 }}>
        <div className="inline">
          {e.category ? (
            <span className="badge" style={{ background: "rgba(255,200,87,0.14)", color: "#FFC857" }}>{CATEGORY_LABELS[e.category].toUpperCase()}</span>
          ) : e.app === "cookpool" ? (
            <span className="badge" style={{ background: "rgba(76,201,138,0.14)", color: "#6FD9A3" }}>COOKPOOL</span>
          ) : null}
          {e.paymentMethod ? (
            <span className="badge" style={{ background: "rgba(127,216,176,0.14)", color: "#7FD8B0" }}>
              {e.paymentMethod === "upi" ? "UPI" : e.paymentMethod === "bank" ? "BANK TRANSFER" : e.paymentMethod === "cash" ? "CASH" : "PAYMENT"}
            </span>
          ) : null}
          {e.method && METHOD_LABELS[e.method].tag ? <span className="badge" style={{ background: "#1A3050", color: "#93C5FD" }}>{METHOD_LABELS[e.method].tag!.toUpperCase()}</span> : null}
        </div>
        <h1 className="h1">{e.title}</h1>
        <div className="bigmoney md" style={{ textDecoration: e.state === "current" ? undefined : "line-through" }}>
          <span className="w" style={{ fontSize: 38 }}>{whole}</span>
          <span className="f dim">{fraction}</span>
        </div>
        <span className="small dim" style={{ fontSize: 13 }}>
          {whoPaid(e, names, me).replace(/ paid .*$/, " paid")} · {longDate(e.occurredAt)} · {e.groupName} · added by {nameOf(names, e.createdBy, me)}
          {e.viaDelegation ? ` ${viaChip(e)}` : ""}
        </span>
        {e.note ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>“{e.note}”</p> : null}
      </section>

      {e.kind !== "settlement" && (myShare > 0 || net !== 0) ? (
        <div className={net < 0 ? "warnbox row-between" : "goldbox row-between"} style={net >= 0 ? { background: "rgba(94,234,212,0.07)", borderColor: "rgba(94,234,212,0.3)" } : undefined}>
          <span style={{ fontSize: 14, color: "var(--text-2)" }}>
            {net < 0 ? `Your share — you owe ${payer && payer.subjectId !== me ? nameOf(names, payer.subjectId, me) : "the payers"}` : net > 0 ? "You lent" : "Your share"}
          </span>
          <b className={net < 0 ? "owe" : "get"} style={{ fontSize: 18 }}>{formatMoney(net !== 0 ? Math.abs(net) : myShare, cur)}</b>
        </div>
      ) : null}

      <section aria-label="Breakdown by person" className="table">
        <div className="tr th">
          <span>Person</span>
          <span>{itemized ? "Items" : "Paid"}</span>
          <span>{itemized ? "Tax" : ""}</span>
          <span>Share</span>
        </div>
        {e.breakdown.map((b) => {
          const name = nameOf(names, b.subjectId, me);
          return (
            <div key={b.subjectId} className="tr">
              <span className="inline" style={{ gap: 8, fontWeight: 500, flexWrap: "nowrap" }}>
                <Avatar id={b.subjectId} name={name} me={me} size={24} />
                <span className="ellipsis">{name}</span>
              </span>
              <span className="muted">{formatMoney(itemized ? b.itemsMinor : b.paidMinor, cur)}</span>
              <span className="muted">{itemized ? formatMoney(b.adjustmentsMinor, cur) : ""}</span>
              <span className="money" style={{ fontWeight: 500 }}>{formatMoney(b.owedMinor, cur)}</span>
            </div>
          );
        })}
        <div className="tr tot">
          <span>Total</span>
          <span>{formatMoney(itemized ? e.breakdown.reduce((s, b) => s + b.itemsMinor, 0) : e.totalMinor, cur)}</span>
          <span>{itemized ? formatMoney(e.breakdown.reduce((s, b) => s + b.adjustmentsMinor, 0), cur) : ""}</span>
          <span>{formatMoney(e.totalMinor, cur)}</span>
        </div>
      </section>

      {itemized && me && e.items.some((it) => it.shares.some((s) => s.subjectId === me)) ? (
        <section aria-label="Your items" className="panel" style={{ gap: 8, padding: 14 }}>
          <span className="small bold muted" style={{ fontSize: 13 }}>What you had</span>
          {myItems(e, me).map((l) => (
            <div key={l.label} className="row-between" style={{ fontSize: 13, color: l.muted ? "var(--muted)" : undefined }}>
              <span>{l.label}</span>
              <span>{formatMoney(l.amountMinor, cur)}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section aria-label="Comments" className="stack">
        <h2 className="eyebrow" style={{ margin: 0 }}>Comments &amp; history</h2>
        {data.comments.map((c) => {
          const name = nameOf(names, c.subjectId, me);
          return (
            <div key={c.id} className="inline" style={{ gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
              <Avatar id={c.subjectId} name={name} me={me} size={30} />
              <div className="bubble">
                {c.body}
                <div className="dim" style={{ fontSize: 11, paddingTop: 4 }}>{name} · {timeAgo(c.createdAt)}</div>
              </div>
            </div>
          );
        })}
        {data.history.map((h) => (
          <div key={`${h.txnId}-${h.action}`} className="inline small dim" style={{ gap: 8 }}>
            <Icon name="sparkle" size={14} />
            {historyText(h, nameOf(names, h.by, me), cur)} · {timeAgo(h.at)}
          </div>
        ))}
        <form className="field" style={{ padding: "0 6px 0 14px" }} onSubmit={send}>
          <label className="sr" htmlFor="comment">Add a comment</label>
          <input id="comment" placeholder="Add a comment" maxLength={1000} value={comment} onChange={(ev) => setComment(ev.target.value)} />
          <button type="submit" aria-label="Send comment" className="iconbtn" style={{ width: 44, height: 44, background: "var(--cobalt)", border: 0, color: "#fff", borderRadius: 10 }} disabled={busy || !comment.trim()}>
            <Icon name="send" size={18} />
          </button>
        </form>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      {confirm ? (
        <Sheet label="Delete this expense" onClose={() => setConfirm(false)}>
          <h2 className="h1" style={{ fontSize: 22 }}>Delete “{e.title}”?</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            Balances change at once, and everyone in {e.groupName} sees it in Activity. You can restore it for 30 days.
          </p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="inline" style={{ flexWrap: "nowrap" }}>
            <button className="btn ghost flex1" onClick={() => setConfirm(false)}>Keep it</button>
            <button className="btn danger flex1" onClick={() => act("delete")} disabled={busy}>{busy ? "Deleting…" : "Delete"}</button>
          </div>
        </Sheet>
      ) : null}
      {notReceived ? (
        <Sheet label="Mark not received" onClose={() => setNotReceived(false)}>
          <h2 className="h1" style={{ fontSize: 22 }}>Didn&apos;t get {formatMoney(e.totalMinor, cur)}?</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            The payment is reversed, so what {payer && payer.subjectId !== me ? nameOf(names, payer.subjectId, me) : "they"} owed you before it comes back. Everyone in {e.groupName} sees it in Activity.
          </p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="inline" style={{ flexWrap: "nowrap" }}>
            <button className="btn ghost flex1" onClick={() => setNotReceived(false)}>I got it</button>
            <button className="btn danger flex1" onClick={markNotReceived} disabled={busy}>{busy ? "Saving…" : "Not received"}</button>
          </div>
        </Sheet>
      ) : null}
      {toast}
    </>
  );
}
