// Share & export: the breakdown as text, the export file names, and the
// breakdown card drawn on a canvas (PNG). The text helpers are pure.

import type { SplitecoExpenseDetail, SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { formatMoney } from "./money";

export interface CardLine {
  name: string;
  amountMinor: number;
}

export interface ShareCardData {
  heading: string;
  title: string;
  subtitle: string;
  lines: CardLine[];
  footer: string;
  currency: string;
}

/** An expense: who owes what. */
export function expenseCard(e: SplitecoExpenseDetail, nameOf: (id: string) => string): ShareCardData {
  const payer = e.payers.length === 1 ? nameOf(e.payers[0]!.subjectId) : `${e.payers.length} people`;
  return {
    heading: `${e.groupName} · ${new Date(e.occurredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    title: e.title,
    subtitle: `${formatMoney(e.totalMinor, e.currency)} · ${payer} paid${e.method === "items" ? " · itemized" : ""}`,
    lines: e.splits.filter((s) => s.owedMinor > 0).map((s) => ({ name: nameOf(s.subjectId), amountMinor: s.owedMinor })),
    footer: "Split with Spliteco",
    currency: e.currency,
  };
}

/** A group: everyone's balance. */
export function groupCard(g: SplitecoGroupResponse, nameOf: (id: string) => string): ShareCardData {
  return {
    heading: g.group.name,
    title: `${formatMoney(g.totalSpentMinor, g.group.currency)} spent`,
    subtitle: `${g.members.length} people · ${g.expenses.length} expenses`,
    lines: g.balances.filter((b) => b.balanceMinor !== 0).map((b) => ({ name: nameOf(b.subjectId), amountMinor: b.balanceMinor })),
    footer: "Balances: + gets money back, − owes",
    currency: g.group.currency,
  };
}

export function cardText(card: ShareCardData): string {
  return [
    card.title,
    `${card.heading} — ${card.subtitle}`,
    ...card.lines.map((l) => `• ${l.name}: ${formatMoney(l.amountMinor, card.currency)}`),
    card.footer,
  ].join("\n");
}

/** "goa-trip-2026-11-12.csv". */
export function exportFileName(groupName: string, ext: "csv" | "json", now = new Date()): string {
  const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${slug}-${day}.${ext}`;
}

/** Save `body` as a file the browser downloads. */
export function download(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The card as a PNG, drawn on a canvas (1080 wide). */
export async function cardPng(card: ShareCardData): Promise<Blob | null> {
  const W = 1080;
  const rowH = 76;
  const H = 520 + card.lines.length * rowH;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = (w: number, s: number) => `${w} ${s}px "Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif`;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#10203A");
  g.addColorStop(1, "#08111F");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // The mark.
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#93C5FD";
  ctx.beginPath();
  ctx.arc(110, 110, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,200,87,0.92)";
  ctx.beginPath();
  ctx.arc(150, 110, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#EEF3FA";
  ctx.font = font(800, 44);
  ctx.fillText("Spliteco", 210, 126);
  ctx.fillStyle = "#8193AB";
  ctx.font = font(600, 30);
  ctx.textAlign = "right";
  ctx.fillText(card.heading, W - 80, 124);
  ctx.textAlign = "left";
  ctx.fillStyle = "#EEF3FA";
  ctx.font = font(800, 60);
  ctx.fillText(card.title, 80, 270);
  ctx.fillStyle = "#A8B6CA";
  ctx.font = font(600, 32);
  ctx.fillText(card.subtitle, 80, 326);
  card.lines.forEach((l, i) => {
    const y = 420 + i * rowH;
    ctx.fillStyle = "#EEF3FA";
    ctx.font = font(600, 36);
    ctx.textAlign = "left";
    ctx.fillText(l.name, 80, y);
    ctx.fillStyle = "#FFC857";
    ctx.font = font(800, 36);
    ctx.textAlign = "right";
    ctx.fillText(formatMoney(l.amountMinor, card.currency), W - 80, y);
  });
  ctx.textAlign = "left";
  ctx.fillStyle = "#8193AB";
  ctx.font = font(600, 28);
  ctx.fillText(card.footer, 80, H - 70);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
