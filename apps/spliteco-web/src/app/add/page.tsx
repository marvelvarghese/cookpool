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
import { buildSplitecoSplits } from "@saas/kitchen-engine/splits";
import { Icon } from "@/components/icons";
import { Avatar, Screen, Sheet, useQueryParams } from "@/components/ui";
import { PaidByView } from "@/components/add/paid-by";
import { SplitView } from "@/components/add/split-view";
import { ItemizedView } from "@/components/add/itemized";
import { formatMoney, formatShort, currencySymbol } from "@/lib/money";
import { namesFrom, nameOf } from "@/lib/people";
import type { FormCtx } from "@/components/add/types";
import { CATEGORY_LABELS, CATEGORY_TINTS, guessCategory } from "@/lib/activity-text";
import { METHOD_LABELS, buildRequest, emptyItem, switchFromItems, formFromInput, newForm, payersOf, splitInput, toSpec, totalOf, type ExpenseForm } from "@/lib/split-form";
import { problemText } from "@/lib/problems";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { applyScan, takeScan, type ScanHandoff } from "@/lib/scan";
import { liveDraftFrom } from "@/lib/live";
import { sessionStore } from "@/lib/return-to";

type View = "main" | "paid" | "split" | "items";


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
  const [picker, setPicker] = React.useState<"group" | "category" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const keyRef = React.useRef<string | null>(null);
  const titleTouchedCategory = React.useRef(false);
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
            open("split");
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
        <button className="btn big" onClick={() => router.push("/groups")}>Go to Groups</button>
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
      if (editId) router.replace(`/expense?id=${encodeURIComponent(r.expense.id)}`);
      // Outside groups: back to the friend it was with.
      else if (group.group.kind === "direct") router.back();
      else router.replace(`/group?id=${encodeURIComponent(group.group.id)}`);
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
      router.push(`/live/${r.session.code}`);
    } catch (err) {
      setError(errorText(err));
      setLiveBusy(false);
    }
  }

  if (view === "paid") return <PaidByView ctx={ctx} onDone={back} />;
  if (view === "split") {
    return (
      <SplitView
        ctx={ctx}
        onDone={back}
        onItems={() => {
          setForm((f) => ({ ...f, method: "items", items: f.items.length ? f.items : [{ ...emptyItem(), name: f.title, totalText: f.amountText }] }));
          open("items");
        }}
      />
    );
  }
  if (view === "items") {
    return (
      <ItemizedView
        ctx={ctx}
        title={form.title || "Itemized bill"}
        groupName={group.group.kind === "direct" ? "Outside groups" : group.group.name}
        onBack={back}
        onSwitch={(method) => {
          setForm((f) => switchFromItems(f, method, true));
          back();
        }}
        onSave={save}
        canSave={built.ok}
        busy={busy}
        error={error}
        {...(editId ? {} : { onLive: openLive, liveBusy })}
      />
    );
  }

  const total = totalOf(form);
  const preview = total && total > 0 ? buildSplitecoSplits(total, payersOf(form, total), toSpec(splitInput(form))) : null;
  const owedBy = new Map(preview?.ok ? preview.result.owed.map((o) => [o.subjectId, o.owedMinor]) : []);
  const payerLabel =
    form.payerMode === "one" ? nameOf(names, form.payer, me) : `${payersOf(form, total ?? 0).length} people`;
  const groupLabel = group.group.kind === "direct" ? `Just you & ${form.members.filter((m) => m !== me).map((m) => nameOf(names, m, me)).join(", ")}` : `${group.group.name} · all ${form.members.length}`;
  const cat = form.category ?? guessCategory(form.title);
  const catTint = CATEGORY_TINTS[cat ?? "other"];
  const touched = form.title.trim() !== "" || form.amountText.trim() !== "";
  const firstProblem = !built.ok && touched ? built.problems[0] : null;

  return (
    <>
      <div className="page form" style={{ padding: 0 }}>
        <header className="hdr">
          <button className="iconbtn" aria-label="Close without saving" onClick={() => router.back()}>
            <Icon name="close" />
          </button>
          <div className="hdr-title">
            <h1>{editId ? "Edit expense" : "Add expense"}</h1>
          </div>
          <span style={{ width: 44 }} />
        </header>

        <div className="inline">
          <span className="small dim bold" style={{ fontSize: 13 }}>With</span>
          <button className="chip on" onClick={() => (editId ? undefined : setPicker("group"))} disabled={!!editId} aria-label={`Group: ${groupLabel}${editId ? "" : ". Change"}`}>
            <Icon name={group.group.kind} size={16} />
            {groupLabel}
          </button>
          {editId ? null : (
            <button className="chip" style={{ marginLeft: "auto" }} onClick={() => router.push(`/scan?group=${encodeURIComponent(group.group.id)}`)}>
              <Icon name="camera" size={16} />
              Scan a receipt
            </button>
          )}
        </div>

        <section className="card" style={{ gap: 12, padding: 18 }}>
          <label className="inline" style={{ gap: 12, flexWrap: "nowrap" }}>
            <span className="sr">Amount</span>
            <span style={{ height: 52, padding: "0 12px", borderRadius: 14, background: "var(--raised)", border: "1px solid var(--line)", color: "var(--money)", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", flex: "none" }}>
              {currencySymbol(currency).trim()} {currency}
            </span>
            {form.method === "items" ? (
              <span style={{ flex: 1, fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em" }}>{formatShort(total ?? 0, currency).replace(/^[^\d]+/, "")}</span>
            ) : (
              <input
                inputMode="decimal"
                placeholder="0"
                value={form.amountText}
                onChange={(e) => setForm((f) => ({ ...f, amountText: e.target.value }))}
                style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "var(--text)", fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em" }}
              />
            )}
          </label>
          <label className="inline" style={{ gap: 12, borderTop: "1px solid var(--line)", paddingTop: 12, flexWrap: "nowrap" }}>
            <button
              type="button"
              aria-label={`Category: ${cat ? CATEGORY_LABELS[cat] : "none"}. Change`}
              onClick={() => setPicker("category")}
              style={{ width: 44, height: 44, borderRadius: 14, background: catTint.tint, color: catTint.ink, border: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
            >
              <Icon name={cat ?? "other"} />
            </button>
            <span className="sr">What was it for?</span>
            <input
              placeholder="What was it for?"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "var(--text)", fontSize: 18, fontWeight: 600 }}
            />
          </label>
          {cat && !form.category && !titleTouchedCategory.current ? (
            <span className="small dim" style={{ paddingLeft: 56 }}>
              Category guessed: <b style={{ color: catTint.ink }}>{CATEGORY_LABELS[cat]}</b> · tap the icon to change
            </span>
          ) : null}
        </section>

        <section aria-label="How it is split" className="panel">
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.9, color: "var(--text-2)" }}>
            Paid by{" "}
            <button className="pick payer" onClick={() => open("paid")}>{payerLabel}</button>{" "}
            and split{" "}
            <button className="pick split" onClick={() => {
                open("split");
                if (form.method === "items") open("items");
              }}>{METHOD_LABELS[form.method].phrase}</button>
          </p>
          {owedBy.size > 0 ? (
            <div className="grid4">
              {[...owedBy.entries()].slice(0, 8).map(([id, owed]) => (
                <div key={id} className="stack" style={{ alignItems: "center", gap: 6, padding: "10px 4px", borderRadius: 14, background: "var(--raised)" }}>
                  <Avatar id={id} name={nameOf(names, id, me)} me={me} size={34} />
                  <span className="small muted ellipsis" style={{ maxWidth: "100%" }}>{nameOf(names, id, me)}</span>
                  <span className="money" style={{ fontSize: 13, fontWeight: 700 }}>{formatShort(owed, currency)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <div className="grid2" style={{ gap: 8 }}>
          <label className="field" style={{ height: 48, padding: "0 12px" }}>
            <Icon name="calendar" size={18} />
            <span className="sr">Date</span>
            <input type="date" value={form.occurredOn} onChange={(e) => setForm((f) => ({ ...f, occurredOn: e.target.value || f.occurredOn }))} style={{ fontSize: 13, fontWeight: 600 }} />
          </label>
          <label className="field" style={{ height: 48, padding: "0 12px" }}>
            <Icon name="noteIcon" size={18} />
            <span className="sr">Note</span>
            <input placeholder="Add a note" maxLength={500} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={{ fontSize: 13, fontWeight: 600 }} />
          </label>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>

      <div className="footer-fixed">
        <div>
          <div className="inline" style={{ justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 600, color: built.ok ? "var(--ok)" : "var(--owe)" }} aria-live="polite">
            {built.ok ? <Icon name="check" size={16} /> : null}
            {built.ok ? `Adds up to ${formatMoney(built.request.totalMinor, currency)}` : firstProblem ? problemText(firstProblem, names, me, currency) : ""}
          </div>
          <button className="btn big" onClick={save} disabled={!built.ok || busy}>
            {busy ? "Saving…" : editId ? "Save changes" : "Save expense"}
          </button>
        </div>
      </div>

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
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  <span className="small dim">{g.memberCount} people{g.madeIn === "cookpool" ? " · From Cookpool" : ""}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="note">To split with one friend outside groups, open them under Groups → Friends.</p>
        </Sheet>
      ) : null}
      {picker === "category" ? (
        <Sheet label="Category" onClose={() => setPicker(null)}>
          <h2 className="h1" style={{ fontSize: 22 }}>Category</h2>
          <div className="grid2" style={{ gap: 8 }}>
            {SPLITECO_CATEGORIES.map((c: SplitecoCategory) => (
              <button
                key={c}
                className="prow"
                aria-pressed={cat === c}
                style={{ color: "var(--text)", borderColor: cat === c ? "var(--cobalt-ring)" : undefined, minHeight: 52 }}
                onClick={() => {
                  titleTouchedCategory.current = true;
                  setForm((f) => ({ ...f, category: c }));
                  setPicker(null);
                }}
              >
                <span className="cat" style={{ width: 32, height: 32, borderRadius: 10, background: CATEGORY_TINTS[c].tint, color: CATEGORY_TINTS[c].ink }}>
                  <Icon name={c} size={16} />
                </span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{CATEGORY_LABELS[c]}</span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
