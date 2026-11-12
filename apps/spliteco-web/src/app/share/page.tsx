"use client";

import * as React from "react";
import { Mark } from "@/components/icons";
import { BackButton, Loading, Screen, useLoad, useQueryParams, useToast } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { nameOf, namesFrom } from "@/lib/people";
import { cardPng, cardText, download, expenseCard, exportFileName, groupCard, type ShareCardData } from "@/lib/share";
import { errorText, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";

export default function SharePage() {
  const params = useQueryParams();
  const { me } = useMe();
  const meId = me?.id ?? null;
  const load = useLoad(
    async (c) => {
      if (!params) return new Promise<never>(() => undefined);
      const expenseId = params.get("expense");
      if (expenseId) {
        const x = await c.spliteco.expense(expenseId);
        const names = namesFrom(x.people);
        return { card: expenseCard(x.expense, (id) => nameOf(names, id, meId)), groupId: x.expense.groupId, groupName: x.expense.groupName, link: `/expense?id=${encodeURIComponent(expenseId)}` };
      }
      const groupId = params.get("group");
      if (!groupId) throw new Error("Nothing to share");
      const g = await c.spliteco.group(groupId);
      const names = namesFrom(g.members, g.people);
      return { card: groupCard(g, (id) => nameOf(names, id, meId)), groupId, groupName: g.group.name, link: `/group?id=${encodeURIComponent(groupId)}` };
    },
    [params, meId],
  );
  return (
    <Screen nav={false}>
      <header className="hdr">
        <BackButton label="Close" />
        <div className="hdr-title"><h1>Share &amp; export</h1></div>
        <span style={{ width: 44 }} />
      </header>
      <Loading load={load}>{load.data ? <Share {...load.data} /> : null}</Loading>
    </Screen>
  );
}

function Share({ card, groupId, groupName, link }: { card: ShareCardData; groupId: string; groupName: string; link: string }) {
  const { client } = useSession();
  const [toast, say] = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") say(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const actions: { badge: string; label: string; tone: "gold" | "blue" | "mint"; go: () => Promise<void> }[] = [
    {
      badge: "IMG",
      label: "Share image",
      tone: "gold",
      go: async () => {
        const png = await cardPng(card);
        if (!png) throw new Error("This browser can't draw the image.");
        const file = new File([png], exportFileName(groupName, "csv").replace(/\.csv$/, ".png"), { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: card.title });
        else {
          const url = URL.createObjectURL(png);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          say("Image saved");
        }
      },
    },
    {
      badge: "TXT",
      label: "Copy as text",
      tone: "blue",
      go: async () => {
        await navigator.clipboard.writeText(cardText(card));
        say("Copied");
      },
    },
    {
      badge: "LINK",
      label: "Copy link",
      tone: "blue",
      go: async () => {
        await navigator.clipboard.writeText(`${window.location.origin}${link}`);
        say("Link copied — it opens for people in the group");
      },
    },
    {
      badge: "CSV",
      label: "Export CSV",
      tone: "mint",
      go: async () => {
        const csv = await client.spliteco.exportCsv(groupId);
        download(exportFileName(groupName, "csv"), csv, "text/csv;charset=utf-8");
        say("CSV saved");
      },
    },
    {
      badge: "JSON",
      label: "Export JSON",
      tone: "mint",
      go: async () => {
        const json = await client.spliteco.exportJson(groupId);
        download(exportFileName(groupName, "json"), JSON.stringify(json, null, 2), "application/json");
        say("JSON saved");
      },
    },
  ];
  const tones = {
    gold: { tint: "rgba(255,200,87,0.14)", ink: "#FFC857" },
    blue: { tint: "rgba(96,165,250,0.16)", ink: "#93C5FD" },
    mint: { tint: "rgba(127,216,176,0.14)", ink: "#7FD8B0" },
  };

  return (
    <>
      <figure aria-label="Image that will be shared" className="share-card" style={{ margin: 0 }}>
        <div className="row-between">
          <span className="inline" style={{ gap: 8 }}>
            <Mark size={26} />
            <span style={{ fontWeight: 800 }}>Spliteco</span>
          </span>
          <span className="small" style={{ color: "#8193AB" }}>{card.heading}</span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{card.title}</span>
          <span className="small" style={{ color: "#A8B6CA" }}>{card.subtitle}</span>
        </div>
        <div className="stack s8">
          {card.lines.map((l) => (
            <div key={l.name} className="row-between" style={{ fontSize: 15 }}>
              <span>{l.name}</span>
              <b style={{ color: "#FFC857" }}>{formatMoney(l.amountMinor, card.currency)}</b>
            </div>
          ))}
          {card.lines.length === 0 ? <span className="small" style={{ color: "#8193AB" }}>Everyone is square.</span> : null}
        </div>
        <span className="small" style={{ color: "#8193AB" }}>{card.footer}</span>
      </figure>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {actions.map((a) => (
          <button
            key={a.badge}
            onClick={() => run(a.badge, a.go)}
            disabled={busy !== null}
            className="stack"
            style={{ alignItems: "center", gap: 8, padding: "14px 6px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--text)" }}
          >
            <span className="badge" style={{ background: tones[a.tone].tint, color: tones[a.tone].ink }}>{a.badge}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{busy === a.badge ? "Working…" : a.label}</span>
          </button>
        ))}
      </div>
      <p className="note">
        CSV and JSON hold every expense in {groupName}. The link opens for anyone in the group; people outside it see only the image — never balances from other groups.
      </p>
      {toast}
    </>
  );
}
