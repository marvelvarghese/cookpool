"use client";

import * as React from "react";
import Link from "./link";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Plug, X } from "lucide-react";
import type { DelegationsListResponse } from "@saas/sdk";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { mcpOrigin, mcpPublicUrl } from "@/lib/app-config";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BackButton } from "./back-ui";
import { KCard, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { SEG_OFF, SEG_ON, SEG_TRACK } from "./rv-look";
import { copyLink } from "./recipe-share";
import {
  ASSISTANTS_HREF,
  ASSISTANTS_LEAD,
  ASSISTANTS_TITLE,
  ASSISTANT_TABS,
  CANT_DO,
  CAN_DO,
  CONNECTOR_LABEL,
  NO_CONNECTOR,
  assistantTab,
  connectedLabel,
  connectedRows,
  disconnectFlow,
  disconnectedToast,
  mcpConnectApi,
  withoutDelegation,
  type AssistantTabId,
} from "./assistants";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// RV-18: section headings as the boards draw them (17 px, Medium), not 12 px capitals.
const LABEL = K_SECTION;

/** You's row (new frame): opens Connected assistants. */
export function AssistantsRow() {
  return (
    <Link
      href={ASSISTANTS_HREF}
      className={cn("flex min-h-16 items-center gap-3 rounded-cp-card bg-card px-4 py-2.5 shadow-cp-card transition-colors hover:bg-accent", FOCUS)}
    >
      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-cp-herb-tint text-primary">
        <Plug className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-base font-medium">{ASSISTANTS_TITLE}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/**
 * You → Connected assistants (cookpool-mcp MC-4, the canvas's `McpConnect`):
 * the connector URL for this environment with Copy; Gemini · Claude ·
 * ChatGPT with three short steps each; the assistants connected now, each
 * with Disconnect (no Undo: a revoked token can't come back); what an
 * assistant can and can't do.
 */
export function AssistantsScreen() {
  const { client, token, target } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const url = mcpPublicUrl(target.name);
  const origin = mcpOrigin(target.name);
  const [tab, setTab] = React.useState<AssistantTabId>("gemini");
  const [copied, setCopied] = React.useState(false);
  const [dropping, setDropping] = React.useState<string | null>(null);
  const [now] = React.useState(() => new Date());
  const list = useApiQuery(qk.assistantDelegations(), () => wrap(() => client.auth.delegations()));
  const rows = React.useMemo(() => connectedRows(list.data?.delegations, now), [list.data, now]);
  const shown = assistantTab(tab);

  const copy = async () => {
    if (!url) return;
    if (await copyLink(url, typeof navigator !== "undefined" ? navigator.clipboard : null)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast({ kind: "warning", title: "Couldn't copy · tap the URL to select it" });
    }
  };

  const disconnect = async (id: string, name: string) => {
    if (dropping) return;
    setDropping(id);
    const api = origin ? mcpConnectApi(origin, token, (u, init) => fetch(u, init)) : null;
    const out = await disconnectFlow(
      { revokeDelegation: (d) => wrap(() => client.auth.revokeDelegation(d)), mcpDisconnect: api ? (d) => api.disconnect(d) : null },
      id,
    );
    setDropping(null);
    if (!out.ok) {
      toast({ kind: "error", title: out.message });
      return;
    }
    qc.setQueryData<DelegationsListResponse>(qk.assistantDelegations(), (old) =>
      old ? { ...old, delegations: withoutDelegation(old.delegations, id) } : old,
    );
    toast({ kind: "success", ...disconnectedToast(name) });
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5 min-[900px]:gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton />
          <h1 className={K_TITLE}>{ASSISTANTS_TITLE}</h1>
        </div>
        <p className="text-sm font-normal text-muted-foreground">{ASSISTANTS_LEAD}</p>
      </header>

      <KCard className="flex flex-col gap-2.5 p-3.5">
        <h2 className={LABEL}>{CONNECTOR_LABEL}</h2>
        <div className="flex items-center gap-2 rounded-[14px] bg-secondary py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 select-all truncate font-mono text-[13px]" title={url ?? undefined}>
            {url ?? NO_CONNECTOR}
          </span>
          <Button
            type="button"
            disabled={!url}
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy the connector URL"}
            className="h-11 min-w-[76px] shrink-0 gap-1 rounded-[10px] px-3 text-sm font-medium"
          >
            {copied ? (
              <>
                Copied <Check className="h-4 w-4" aria-hidden />
              </>
            ) : (
              "Copy"
            )}
          </Button>
        </div>
        <div role="tablist" aria-label="Your assistant" className={cn("grid grid-cols-3 gap-1", SEG_TRACK)}>
          {ASSISTANT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`assistant-tab-${t.id}`}
              aria-selected={t.id === shown.id}
              aria-controls="assistant-steps"
              onClick={() => setTab(t.id)}
              className={cn(
                "min-h-11 rounded-xl text-sm font-medium transition-colors",
                t.id === shown.id ? SEG_ON : SEG_OFF,
                FOCUS,
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id="assistant-steps" role="tabpanel" aria-labelledby={`assistant-tab-${shown.id}`} className="flex flex-col gap-1.5">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm font-normal text-foreground">
            {shown.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {shown.note ? <p className="text-[13px] font-normal text-cp-soon">{shown.note}</p> : null}
        </div>
      </KCard>

      <section aria-labelledby="assistants-connected" className="flex flex-col gap-1.5">
        <h2 id="assistants-connected" className={cn(LABEL, "px-0.5")}>
          {list.loading ? "Connected" : connectedLabel(rows.length)}
        </h2>
        {list.loading ? (
          <Skeleton className="h-16 w-full rounded-cp-card" />
        ) : list.error && !list.data ? (
          <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load your assistants.</p>
            <Button variant="outline" className={K_BUTTON_QUIET} onClick={list.reload}>
              Try again
            </Button>
          </KCard>
        ) : rows.length === 0 ? (
          <KCard className="px-4 py-3.5 text-sm font-normal text-muted-foreground">None yet</KCard>
        ) : (
          <ul className={K_ROWS}>
            {rows.map((row) => (
              <li key={row.id} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary">
                  <Plug className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium">{row.name}</span>
                  <span className="text-[13px] font-normal text-muted-foreground">{row.sub}</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  loading={dropping === row.id}
                  disabled={dropping !== null}
                  onClick={() => void disconnect(row.id, row.name)}
                  aria-label={`Disconnect ${row.name}`}
                  className="h-11 shrink-0 rounded-xl border-0 bg-cp-expired-tint px-3 text-sm font-medium text-destructive shadow-none hover:bg-cp-expired-tint/80 hover:text-destructive"
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="assistants-can" className={cn(K_CARD, "flex flex-col gap-1.5 px-3.5 py-3 text-sm font-normal text-foreground")}>
        <h2 id="assistants-can" className={LABEL}>
          What it can do
        </h2>
        <ul className="flex flex-col gap-1.5">
          {CAN_DO.map((s) => (
            <li key={s} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.4} aria-label="Can" />
              <span>{s}</span>
            </li>
          ))}
          {CANT_DO.map((s) => (
            <li key={s} className="flex gap-2">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={2.4} aria-label="Can't" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
