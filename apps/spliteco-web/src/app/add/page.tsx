"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  SPLITECO_CATEGORIES,
  type SplitecoCategory,
  type SplitecoGroupResponse,
  type SplitecoGroupSummary,
  type SplitecoSplitMethod,
} from "@saas/contracts/spliteco";
import { Icon } from "../../components/icons";
import { Avatar, Screen, Sheet, useQueryParams } from "../../components/ui";
import { PaidByView } from "../../components/add/paid-by";
import { AddSheet } from "../../components/add/add-sheet";
import { ItemizedView } from "../../components/add/itemized";
import { namesFrom, nameOf } from "../../lib/people";
import type { FormCtx } from "../../components/add/types";
import { CATEGORY_LABELS, CATEGORY_TINTS, guessCategory } from "../../lib/activity-text";
import { buildRequest, formFromInput, newForm, payersOf, todayIso, totalOf, type ExpenseForm } from "../../lib/split-form";
import { AMOUNT, payerChip, saveLabel, type Selected } from "../../lib/add-split";
import { errorText, newIdempotencyKey, useSession } from "../../lib/session";
import { useMe } from "../../lib/me";
import { applyScan, takeScan, type ScanHandoff } from "../../lib/scan";
import { liveDraftFrom } from "../../lib/live";
import { sessionStore } from "../../lib/return-to";
import { to } from "../../lib/paths";

type View = "main" | "paid" | "items";


export default function AddPage() {
  return (
    <Screen nav={false}>
      <Add />
    </Screen>
  );
}

function Add() {
  const params = useQueryParams();
  const router = useRouter();
  const { client } = useSession();
  const { me: meUser } = useMe();
  const me = meUser?.id ?? null;

  const [groups, setGroups] = React.useState<SplitecoGroupSummary[] | null>(null);
  const [groupId, setGroupId] = React.useState<string | null>(null);
  const [group, setGroup] = React.useState<SplitecoGroupResponse | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [form, setFormState] = React.useState<ExpenseForm | null>(null);
  const [view, setView] = React.useState<View>("main");
  // Who paid, Split and Itemized are views of one form, each a history entry,
  // so the back arrow and the browser's Back step out one view at a time
  // (Itemized → Split → the expense) and never leave the form stuck.
  const open = React.useCallback((v: View) => {
    window.history.pushState({ ...(window.history.state ?? {}), splitecoView: v }, "");
    setView(v);
  }, []);
  const back = React.useCallback(() => window.history.back(), []);
  const openedItems = React.useRef(false);
  React.useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const v = (e.state as { splitecoView?: View } | null)?.splitecoView;
      setView(v ?? "main");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [picker, setPicker] = React.useState<"group" | "details" | null>(null);
  // What the keypad types into: the amount, or the selected person's field.
  const [sel, setSel] = React.useState<Selected>(AMOUNT);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const keyRef = React.useRef<string | null>(null);
  // A scanned receipt handed over by /scan (SE4), read once and kept for this form.
  const scanRef = React.useRef<ScanHandoff | null | undefined>(undefined);
  const [liveBusy, setLiveBusy] = React.useState(false);

  const setForm = React.useCallback((f: ExpenseForm | ((f: ExpenseForm) => ExpenseForm)) => {
    keyRef.current = null;
    setFormState((cur) => (cur ? (typeof f === "function" ? f(cur) : f) : cur));
  }, []);

  // Where it goes: ?group=, the group of the expense being edited, else the caller's first group.
  React.useEffect(() => {
    if (!params) return;
    let live = true;
    const edit = params.get("edit");
    setEditId(edit);
    (async () => {
      try {
        const list = await client.spliteco.groups();
        if (!live) return;
        setGroups(list.groups);
        if (edit) {
          const x = await client.spliteco.expense(edit);
          if (!live) return;
          setGroupId(x.expense.groupId);
          return;
        }
        setGroupId(params.get("group") ?? list.groups.find((g) => g.role !== "viewer")?.id ?? null);
      } catch (err) {
        if (live) setError(errorText(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [params, client]);

  // The group's members and currency; the form starts (or is prefilled for an edit).
  React.useEffect(() => {
    if (!groupId || !params) return;
    let live = true;
    (async () => {
      try {
        const g = await client.spliteco.group(groupId);
        if (!live) return;
        setGroup(g);
        const members = g.members.map((m) => m.subjectId);
        const meId = me ?? members[0] ?? "";
        const edit = params.get("edit");
        if (edit) {
          const x = await client.spliteco.expense(edit);
          if (!live) return;
          if (x.expense.input) setFormState(formFromInput(x.expense.input, members, meId));
          else setError("Cookpool posted this one — change it in Cookpool.");
        } else {
          if (scanRef.current === undefined) scanRef.current = params.get("from") === "scan" ? takeScan(sessionStore()) : null;
          const scan = scanRef.current;
          setFormState((cur) => {
            const method = (params.get("method") as SplitecoSplitMethod | null) ?? cur?.method ?? "equal";
            let next = newForm(members, meId, method);
            if (cur) {
              next.title = cur.title;
              next.amountText = cur.amountText;
              next.category = cur.category;
              next.note = cur.note;
              next.occurredOn = cur.occurredOn;
              // Items typed (or scanned) so far stay, with only this group's people on them.
              if (cur.method === "items" && next.method === "items" && cur.items.length > 0) {
                const inGroup = new Set(members);
                next.items = cur.items.map((it) => ({ ...it, shares: Object.fromEntries(Object.entries(it.shares).filter(([id]) => inGroup.has(id))) }));
                next.adjustments = cur.adjustments;
              }
            }
            // The scan fills the items (or the total) once; nothing is saved until Save.
            if (scan && !cur) next = applyScan(next, scan.draft, scan.how);
            return next;
          });
          if (params.get("method") === "items" && !openedItems.current) {
            openedItems.current = true;
            open("items");
          }
        }
      } catch (err) {
        if (live) setError(errorText(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [groupId, client, me, params, open]);

  if (error && !form) {
    return (
      <div className="stack">
        <header className="hdr">
          <button className="iconbtn" aria-label="Close" onClick={() => router.back()}><Icon name="close" /></button>
        </header>
        <p className="error" role="alert">{error}</p>
      </div>
    );
  }
  if (groups && groups.length === 0) {
    return (
      <div className="stack">
        <header className="hdr">
          <button className="iconbtn" aria-label="Close" onClick={() => router.back()}><Icon name="close" /></button>
          <div className="hdr-title"><h1>Add expense</h1></div>
          <span style={{ width: 44 }} />
        </header>
        <p className="empty">Make a group first — expenses live in a group (or with a friend).</p>
        <button className="btn big" onClick={() => router.push(to("/groups"))}>Go to Groups</button>
      </div>
    );
  }
  if (!form || !group) return <div className="spinner" role="status">Loading…</div>;

  const names = namesFrom(group.members, group.people);
  const currency = group.group.currency;
  const ctx: FormCtx = { form, setForm, names, me, currency };
  const built = buildRequest(form, currency);

  async function save() {
    if (!built.ok || !group) return;
    setBusy(true);
    setError(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      const r = editId
        ? await client.spliteco.editExpense(editId, built.request, { idempotencyKey: keyRef.current })
        : await client.spliteco.createExpense(group.group.id, built.request, { idempotencyKey: keyRef.current });
      keyRef.current = null;
      if (editId) router.replace(to(`/expense?id=${encodeURIComponent(r.expense.id)}`));
      // Outside groups: back to the friend it was with.
      else if (group.group.kind === "direct") router.back();
      else router.replace(to(`/group?id=${encodeURIComponent(group.group.id)}`));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function openLive() {
    if (!group || !form) return;
    const draft = liveDraftFrom(form);
    if (!draft.ok) {
      setError(draft.why);
      return;
    }
    setLiveBusy(true);
    setError(null);
    try {
      const r = await client.spliteco.openLive(group.group.id, draft.request, { idempotencyKey: newIdempotencyKey() });
      router.push(to(`/live/${r.session.code}`));
    } catch (err) {
      setError(errorText(err));
      setLiveBusy(false);
    }
  }

  if (view === "paid") return <PaidByView ctx={ctx} onDone={back} />;
  if (view === "items") {
    return (
      <ItemizedView
        ctx={ctx}
        title={form.title}
        groupName={group.group.kind === "direct" ? "Outside groups" : group.group.name}
        onBack={back}
        onSave={save}
        canSave={built.ok}
        saveLabel={busy ? "Saving…" : saveLabel(form, built, names, me, currency)}
        busy={busy}
        error={error}
        {...(editId ? {} : { onLive: openLive, liveBusy })}
      />
    );
  }

  const total = totalOf(form);
  const groupLabel = group.group.kind === "direct" ? form.members.filter((m) => m !== me).map((m) => nameOf(names, m, me)).join(", ") || "Just you" : group.group.name;
  const cat = form.category ?? guessCategory(form.title);
  const label = busy ? "Saving…" : saveLabel(form, built, names, me, currency);
  const firstPayer = form.payerMode === "one" ? form.payer : (payersOf(form, total ?? 0)[0]?.subjectId ?? me ?? form.members[0] ?? "");

  return (
    <>
      <AddSheet
        ctx={ctx}
        sel={sel}
        setSel={setSel}
        onClose={() => router.back()}
        keysOff={picker !== null}
        head={
          <header className="add-head">
            <button className="add-round" aria-label="Close without saving" onClick={() => router.back()}>
              <Icon name="close" size={18} />
            </button>
            <button className="add-group" onClick={() => (editId ? undefined : setPicker("group"))} disabled={!!editId} aria-label={`Group: ${groupLabel}${editId ? "" : ". Change"}`}>
              <Icon name={group.group.kind} size={16} />
              <span className="ellipsis">{groupLabel}</span>
              {editId ? null : <span aria-hidden="true" className="dim">▾</span>}
            </button>
            {editId ? (
              <span style={{ width: 38 }} />
            ) : (
              <button className="add-round money" aria-label="Scan a bill" onClick={() => router.push(to(`/scan?group=${encodeURIComponent(group.group.id)}`))}>
                <Icon name="camera" size={18} />
              </button>
            )}
          </header>
        }
        chips={
          <div className="add-chips">
            <button className="add-chip" onClick={() => open("paid")} aria-label={`${payerChip(form, names, me)} — tap to change`}>
              <Avatar id={firstPayer} name={nameOf(names, firstPayer, me)} me={me} size={24} />
              {payerChip(form, names, me)}
            </button>
            <button className="add-chip" onClick={() => setPicker("details")} aria-label={`${cat ? CATEGORY_LABELS[cat] : "No category"}, ${dayLabel(form.occurredOn)}${form.note.trim() ? ", with a note" : ""} — tap to change`}>
              <span className="add-cat" style={{ background: CATEGORY_TINTS[cat ?? "other"].tint, color: CATEGORY_TINTS[cat ?? "other"].ink }}>
                <Icon name={cat ?? "other"} size={14} />
              </span>
              {dayLabel(form.occurredOn)}
              {form.note.trim() ? <Icon name="noteIcon" size={14} /> : null}
            </button>
          </div>
        }
        onItems={() => open("items")}
        save={
          <>
            {error ? <p className="error" role="alert" style={{ margin: "6px 0 0" }}>{error}</p> : null}
            <button className="btn big round add-save" onClick={save} disabled={!built.ok || busy} aria-live="polite">
              {label}
            </button>
          </>
        }
      />

      {picker === "group" && groups ? (
        <Sheet label="Which group" onClose={() => setPicker(null)}>
          <h2 className="h1" style={{ fontSize: 22 }}>Which group?</h2>
          <div className="stack s8">
            {groups.filter((g) => g.role !== "viewer").map((g) => (
              <button
                key={g.id}
                className="prow"
                style={{ textAlign: "left", color: "var(--text)", borderColor: g.id === groupId ? "var(--cobalt-ring)" : undefined }}
                onClick={() => {
                  setPicker(null);
                  setGroupId(g.id);
                }}
              >
                <span className={`radio ${g.id === groupId ? "on" : ""}`} aria-hidden="true" />
                <span className="main">
                  <span style={{ fontWeight: 500 }}>{g.name}</span>
                  <span className="small dim">{g.memberCount} people{g.madeIn === "cookpool" ? " · From Cookpool" : ""}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="note">To split with one friend outside groups, open them under Groups → Friends.</p>
        </Sheet>
      ) : null}
      {picker === "details" ? (
        <Sheet label="Details" onClose={() => setPicker(null)}>
          <h2 className="h1" style={{ fontSize: 22 }}>Details</h2>
          <div className="grid2" style={{ gap: 8 }}>
            <label className="field" style={{ height: 48, padding: "0 12px" }}>
              <Icon name="calendar" size={18} />
              <span className="sr">Date</span>
              <input type="date" value={form.occurredOn} onChange={(e) => setForm((f) => ({ ...f, occurredOn: e.target.value || f.occurredOn }))} style={{ fontSize: 13, fontWeight: 500 }} />
            </label>
            <label className="field" style={{ height: 48, padding: "0 12px" }}>
              <Icon name="noteIcon" size={18} />
              <span className="sr">Note</span>
              <input placeholder="Add a note" maxLength={500} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={{ fontSize: 13, fontWeight: 500 }} />
            </label>
          </div>
          <span className="small dim">Category{form.category ? "" : cat ? " · guessed from the title" : ""}</span>
          <div className="grid2" style={{ gap: 8 }}>
            {SPLITECO_CATEGORIES.map((c: SplitecoCategory) => (
              <button
                key={c}
                className="prow"
                aria-pressed={cat === c}
                style={{ color: "var(--text)", borderColor: cat === c ? "var(--cobalt-ring)" : undefined, minHeight: 52 }}
                onClick={() => setForm((f) => ({ ...f, category: c }))}
              >
                <span className="cat" style={{ width: 32, height: 32, borderRadius: 10, background: CATEGORY_TINTS[c].tint, color: CATEGORY_TINTS[c].ink }}>
                  <Icon name={c} size={16} />
                </span>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{CATEGORY_LABELS[c]}</span>
              </button>
            ))}
          </div>
          <button className="btn big" onClick={() => setPicker(null)}>Done</button>
        </Sheet>
      ) : null}
    </>
  );
}

/** "Today", "Yesterday", or "12 Nov" for the details chip. */
function dayLabel(iso: string, now = new Date()): string {
  const today = todayIso(now);
  if (iso === today) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (iso === todayIso(y)) return "Yesterday";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
