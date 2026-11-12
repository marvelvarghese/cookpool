"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, Plug } from "lucide-react";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { mcpOrigin } from "@/lib/app-config";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "./data";
import { K_CARD, K_QUIET } from "./kit";
import { shownName } from "./you";
import {
  ALLOWED_TEXT,
  CANCELLED_TEXT,
  CONSENT_TITLE,
  DISCONNECT_HINT,
  EXPIRED_TEXT,
  NEVER_MOVES_MONEY,
  SCOPE_ROWS,
  allowFlow,
  canAllow,
  cancelFlow,
  clientNameOf,
  connectReqFrom,
  defaultSwitches,
  flipScope,
  loadOutcome,
  mcpConnectApi,
  returnsToLine,
  type ConnectOutcome,
  type ConnectRequestInfo,
  type ScopeSwitches,
} from "./assistants";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type View = { kind: "loading" } | { kind: "ready"; info: ConnectRequestInfo } | ConnectOutcome;

/**
 * `/connect?req=<id>` (cookpool-mcp MC-4, the canvas's `McpConsent`): who is
 * asking, the four switches, the never-moves-money note, Cancel · Allow. The
 * kitchen frame has already signed the person in (and brought them back
 * here, `req` and all). mcp-worker is reached on its own origin with plain
 * `fetch` (`mcpConnectApi`); identity through the SDK.
 */
export function ConnectScreen() {
  const { client, token, target } = useSession();
  const params = useSearchParams();
  const req = connectReqFrom(params?.get("req"));
  const origin = mcpOrigin(target.name);
  const api = React.useMemo(
    () => (origin ? mcpConnectApi(origin, token, (url, init) => fetch(url, init)) : null),
    [origin, token],
  );
  const [view, setView] = React.useState<View>(() => (req && api ? { kind: "loading" } : { kind: "expired" }));
  const [switches, setSwitches] = React.useState<ScopeSwitches>(defaultSwitches);
  const [busy, setBusy] = React.useState<"allow" | "cancel" | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const profile = useProfile();

  React.useEffect(() => {
    if (!req || !api) return;
    let live = true;
    void api.request(req).then((r) => {
      if (live) setView(loadOutcome(r));
    });
    return () => {
      live = false;
    };
  }, [req, api]);

  if (view.kind === "loading") return <ConnectSkeleton />;
  if (view.kind !== "ready") return <ConnectEnd outcome={view} />;
  const info = view.info;
  const name = clientNameOf(info);
  const you = profile.data ? shownName(profile.data) : null;

  const allow = async () => {
    if (!api || busy || !canAllow(switches)) return;
    setBusy("allow");
    setProblem(null);
    const out = await allowFlow(
      {
        createDelegation: (body) => wrap(() => client.auth.createDelegation(body)),
        revokeDelegation: (id) => wrap(() => client.auth.revokeDelegation(id)),
        complete: api.complete,
        go: (url) => window.location.assign(url),
      },
      info,
      switches,
    );
    if (out.kind === "failed") {
      setBusy(null);
      setProblem(out.message);
      return;
    }
    setView(out);
  };

  const cancel = async () => {
    if (!api || busy) return;
    setBusy("cancel");
    setView(await cancelFlow(api, info.req));
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2">
      <TwoIcons />
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">{CONSENT_TITLE}</h1>
        <div className="text-sm font-normal text-muted-foreground [overflow-wrap:anywhere]">
          {you === null ? <Skeleton className="mx-auto h-4 w-56" /> : <RequestedBy name={name} you={you} />}
        </div>
        <p className="text-[13px] font-normal text-muted-foreground [overflow-wrap:anywhere]">{returnsToLine(info)}</p>
      </header>

      <div className={cn(K_CARD, "overflow-hidden")}>
        {SCOPE_ROWS.map((row, i) => {
          const on = switches[row.scope];
          return (
            <button
              key={row.scope}
              type="button"
              role="switch"
              aria-checked={on}
              disabled={busy !== null}
              onClick={() => setSwitches((s) => flipScope(s, row.scope))}
              className={cn("flex min-h-16 w-full items-center gap-3 px-3.5 py-2.5 text-left", i < SCOPE_ROWS.length - 1 && "border-b border-cp-line", FOCUS)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-medium">{row.label}</span>
                <span className="text-[13px] font-normal text-muted-foreground">{row.sub}</span>
              </span>
              <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-input")}>
                <span className={cn("absolute top-[3px] h-[22px] w-[22px] rounded-full bg-cp-card shadow-cp-card transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
              </span>
            </button>
          );
        })}
      </div>

      <p className="rounded-2xl bg-cp-soon-tint px-3.5 py-3 text-[13px] font-medium text-cp-soon">{NEVER_MOVES_MONEY}</p>
      <p className="text-center text-[13px] font-normal text-muted-foreground">{DISCONNECT_HINT}</p>
      {problem ? (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {problem}
        </p>
      ) : null}

      <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          loading={busy === "cancel"}
          onClick={() => void cancel()}
          className={cn("h-14 rounded-[18px] text-base font-medium", K_QUIET)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy !== null || !canAllow(switches)}
          loading={busy === "allow"}
          onClick={() => void allow()}
          className="h-14 rounded-[18px] text-base font-medium"
        >
          Allow
        </Button>
      </div>
    </div>
  );
}

/** `requestedByLine`, with the client's name in bold (plain text, escaped by React). */
function RequestedBy({ name, you }: { name: string; you: string }) {
  return (
    <>
      Requested by <b className="font-medium text-foreground">{name}</b> · signed in as {you}
    </>
  );
}

/** The assistant (a plug: no vendor's mark) and Cookpool. */
function TwoIcons() {
  return (
    <div aria-hidden className="flex items-center justify-center gap-3.5">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-foreground">
        <Plug className="h-7 w-7" strokeWidth={1.8} />
      </span>
      <ArrowLeftRight className="h-5 w-5 text-muted-foreground" strokeWidth={2} />
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-2xl font-medium text-primary-foreground">C</span>
    </div>
  );
}

/** Cancelled, expired, failed to load, or on its way back to the assistant. */
function ConnectEnd({ outcome }: { outcome: ConnectOutcome }) {
  const text =
    outcome.kind === "cancelled" ? CANCELLED_TEXT : outcome.kind === "expired" ? EXPIRED_TEXT : outcome.kind === "allowed" ? ALLOWED_TEXT : outcome.message;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 pt-10 text-center">
      <TwoIcons />
      <p role="status" className="text-lg font-medium [overflow-wrap:anywhere]">
        {text}
      </p>
    </div>
  );
}

function ConnectSkeleton() {
  return (
    <div aria-hidden className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2">
      <Skeleton className="mx-auto h-14 w-40 rounded-2xl" />
      <Skeleton className="mx-auto h-7 w-72" />
      <Skeleton className="h-64 w-full rounded-cp-card" />
      <Skeleton className="h-[58px] w-full rounded-[18px]" />
    </div>
  );
}
