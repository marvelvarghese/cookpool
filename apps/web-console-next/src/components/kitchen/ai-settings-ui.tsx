"use client";

import * as React from "react";
import Link from "./link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { setAiSwitch, useAiSwitch, type AiSwitchKey } from "@/lib/ai-switches";
import { BackButton } from "./back-ui";
import { K_BUTTON } from "./kit";
import { useAiStatus } from "./receipt-data";
import { AiChip } from "./receipt-scan-ui";
import { AI_SETTINGS_HEADING, AI_SETTINGS_HREF, AI_SETTINGS_LEAD, AI_SETTINGS_TITLE, aiSettingsView, type UseBar } from "./ai-settings";

/**
 * You → Cookpool AI (cookpool-ai AI-7, design §7, the canvas's AiSettings):
 * this device's switches (AI-8's `lib/ai-switches.ts`), today's use against
 * the limits as bars with the month's budget, and what is sent. While AI is
 * off it says why, above the switches.
 */

const CARD = "rounded-[20px] border border-[#E3E6E0] bg-card";
const LABEL = "text-xs font-extrabold tracking-[0.06em] text-muted-foreground";

/** Settings' row to it, in the new frame. */
export function AiSettingsRow() {
  return (
    <Link
      href={AI_SETTINGS_HREF}
      className="flex min-h-[60px] items-center gap-3 rounded-3xl border bg-card px-5 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-[#E4F2EA] to-[#FCE9DF] text-base">
        ✨
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold">{AI_SETTINGS_TITLE}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function AiSettingsScreen() {
  const status = useAiStatus();
  const on: Record<AiSwitchKey, boolean> = {
    sayIt: useAiSwitch("sayIt"),
    receipt: useAiSwitch("receipt"),
    import: useAiSwitch("import"),
    voice: useAiSwitch("voice"),
    swaps: useAiSwitch("swaps"),
  };
  const view = aiSettingsView(status.data, { loading: status.loading || (!status.data && !status.error), switchOn: (k) => on[k] });

  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5">
      <header className="flex items-center gap-2">
        <BackButton />
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">{AI_SETTINGS_TITLE}</h1>
      </header>
      <div className="flex flex-col items-start gap-1.5">
        <AiChip />
        <h2 className="text-[22px] font-extrabold leading-tight">{AI_SETTINGS_HEADING}</h2>
        <p className="text-sm font-semibold text-muted-foreground">{AI_SETTINGS_LEAD}</p>
      </div>

      {view.notice ? (
        <p role="status" className="rounded-2xl bg-[#FDF1D6] px-4 py-3 text-[15px] font-extrabold text-[#5C3D00]">
          {view.notice}
        </p>
      ) : null}

      <div role="group" aria-label="Switches" className={cn(CARD, "overflow-hidden")}>
        {view.switches.map((t) => (
          <button
            key={t.key}
            type="button"
            role="switch"
            aria-checked={t.on}
            onClick={() => setAiSwitch(t.key, !t.on)}
            className="flex min-h-[60px] w-full items-center gap-3 border-b border-[#ECEEE9] px-3.5 py-2 text-left last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-extrabold">{t.label}</span>
              <span className="text-xs font-semibold text-muted-foreground">{t.sub}</span>
            </span>
            <span aria-hidden className={cn("flex h-7 w-12 shrink-0 rounded-full p-[3px] transition-colors", t.on ? "justify-end bg-[#1F7A4D]" : "justify-start bg-[#C9CFC6]")}>
              <span className="h-[22px] w-[22px] rounded-full bg-white" />
            </span>
          </button>
        ))}
      </div>

      <section aria-label="Today" className={cn(CARD, "flex flex-col gap-2.5 px-3.5 py-3")}>
        <span className={LABEL}>TODAY</span>
        {view.state === "loading" ? (
          <Skeleton className="h-12 w-full" aria-hidden />
        ) : view.state === "failed" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Couldn&apos;t load today&apos;s use</span>
            <Button variant="outline" className={K_BUTTON} onClick={status.reload}>
              Try again
            </Button>
          </div>
        ) : (
          view.today.map((b) => <UseBarView key={b.label} bar={b} />)
        )}
        {view.budget ? <span className={cn("text-[13px] font-bold", view.state === "resting" ? "text-[#8A5A00]" : "text-muted-foreground")}>{view.budget}</span> : null}
      </section>

      <section aria-label="What is sent" className={cn(CARD, "flex flex-col gap-1.5 px-3.5 py-3 text-sm font-semibold text-[#3F4842]")}>
        <span className={LABEL}>WHAT IS SENT</span>
        {view.sent.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </section>
    </div>
  );
}

function UseBarView({ bar }: { bar: UseBar }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-sm font-bold">
        <span>{bar.label}</span>
        <span className="tabular-nums text-muted-foreground">{bar.text}</span>
      </span>
      <span
        role="meter"
        aria-label={bar.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bar.pct}
        className="block h-2 overflow-hidden rounded-full bg-[#ECEEE9]"
      >
        <span className={cn("block h-full rounded-full", bar.full ? "bg-[#D97706]" : "bg-[#1F7A4D]")} style={{ width: `${bar.pct}%` }} />
      </span>
    </div>
  );
}
