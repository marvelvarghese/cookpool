"use client";

// You → AI assistants (cookpool-spliteco SE-6, canvas `Assistants`): the MCP
// address to paste into Claude, ChatGPT or Gemini; each connected assistant
// with Look only · Add & edit and Disconnect; what an assistant can do here
// and what stays in this app. The logic is in lib/assistants.ts.

import * as React from "react";
import type { Delegation } from "@saas/contracts/delegations";
import { Icon } from "@/components/icons";
import { BackButton, Loading, Screen, useLoad, useToast } from "@/components/ui";
import {
  ADD_HOW,
  ADD_THIS,
  ASSISTANTS_LEAD,
  ASSISTANTS_SUB,
  ASSISTANTS_TITLE,
  CAN,
  DRAFT_NOTE,
  NONE_CONNECTED,
  NO_ADDRESS,
  ONLY_IN_APP,
  assistantRows,
  disconnectFlow,
  mcpDisconnecter,
  mcpOriginFor,
  mcpUrlFor,
  reconnectHint,
  scopesFor,
  withUpdated,
  withoutAssistant,
  type AssistantRow,
} from "@/lib/assistants";
import { errorText, useSession } from "@/lib/session";

export default function AssistantsPage() {
  const load = useLoad((c) => c.auth.delegations(), []);
  const [host, setHost] = React.useState("");
  React.useEffect(() => setHost(window.location.host), []);
  const url = host ? mcpUrlFor(host) : null;
  const [toast, say] = useToast();

  return (
    <Screen>
      <header className="hdr" style={{ gap: 10 }}>
        <BackButton href="/you" label="Back to You" />
        <h1 className="h1" style={{ flex: 1 }}>{ASSISTANTS_TITLE}</h1>
      </header>

      <section className="stack s8">
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{ASSISTANTS_LEAD}</h2>
        <p className="small dim" style={{ margin: 0, lineHeight: 1.5 }}>{ASSISTANTS_SUB}</p>
      </section>

      <section aria-label={ADD_THIS} className="panel">
        <h2 className="eyebrow" style={{ margin: 0 }}>{ADD_THIS}</h2>
        <div className="row-between" style={{ gap: 10 }}>
          <code style={{ flex: 1, minWidth: 0, fontSize: 14, color: "var(--text)", wordBreak: "break-all" }}>{url ?? (host ? NO_ADDRESS : "…")}</code>
          {url ? (
            <button
              className="pillbtn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  say("Copied");
                } catch {
                  say("Couldn't copy · select it instead");
                }
              }}
            >
              <Icon name="copy" size={18} /> Copy
            </button>
          ) : null}
        </div>
        <p className="note">{ADD_HOW}</p>
      </section>

      <Loading load={load}>
        {load.data ? <Connected list={load.data.delegations} host={host} say={say} /> : null}
      </Loading>

      <section aria-label="Assistants can" className="stack s4">
        <h2 className="eyebrow">Assistants can</h2>
        <ul className="stack s8" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {CAN.map((c) => (
            <li key={c} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.4 }}>
              <span style={{ color: "var(--get)", flex: "none" }}><Icon name="check" size={18} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Only in this app" className="stack s4">
        <h2 className="eyebrow">Only in this app</h2>
        <ul className="stack s8" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {ONLY_IN_APP.map((c) => (
            <li key={c} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.4 }}>
              <span style={{ color: "var(--dim)", flex: "none" }}><Icon name="lock" size={18} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="note">{DRAFT_NOTE}</p>
      {toast}
    </Screen>
  );
}

function Connected({ list: initial, host, say }: { list: Delegation[]; host: string; say: (text: string) => void }) {
  const { client, token } = useSession();
  const [list, setList] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [hint, setHint] = React.useState<{ id: string; text: string } | null>(null);
  React.useEffect(() => setList(initial), [initial]);
  const rows = assistantRows(list, new Date());

  async function setAccess(row: AssistantRow, access: "read" | "write") {
    const d = list.find((x) => x.id === row.id);
    if (!d) return;
    const allowed = access === "write" ? row.canWrite : row.canRead;
    if (!allowed) {
      setHint({ id: row.id, text: reconnectHint(row.name, access) });
      return;
    }
    const scopes = scopesFor(d, access);
    if (!scopes) return;
    setHint(null);
    setBusy(row.id);
    try {
      const r = await client.auth.updateDelegation(row.id, { scopes });
      setList((l) => withUpdated(l, r.delegation));
      say(access === "write" ? `${row.name} can add & edit` : `${row.name} can only look`);
    } catch (err) {
      say(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(row: AssistantRow) {
    setBusy(row.id);
    const result = await disconnectFlow(
      {
        revoke: (id) => client.auth.revokeDelegation(id),
        mcpDisconnect: mcpDisconnecter(mcpOriginFor(host), token, fetch.bind(globalThis)),
      },
      row.id,
    );
    setBusy(null);
    if (!result.ok) {
      say(result.message);
      return;
    }
    setList((l) => withoutAssistant(l, row.id));
    say(`Disconnected · ${row.name}`);
  }

  return (
    <section aria-label="Connected assistants" className="stack s4">
      <h2 className="eyebrow">Connected · {rows.length}</h2>
      {rows.length === 0 ? <p className="empty">{NONE_CONNECTED}</p> : null}
      {rows.map((row) => (
        <div key={row.id} className="panel" style={{ gap: 12 }}>
          <div className="inline" style={{ gap: 12 }}>
            <span className="avatar" aria-hidden="true" style={{ width: 40, height: 40, background: "var(--cobalt-soft)", color: "var(--text)", fontSize: 14, fontWeight: 800 }}>
              {row.mono}
            </span>
            <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <span className="ellipsis" style={{ fontSize: 16, fontWeight: 700 }}>{row.name}</span>
              <span className="small dim">{row.status}</span>
            </span>
            <button className="btn danger" style={{ height: 36, fontSize: 13 }} disabled={busy === row.id} onClick={() => disconnect(row)}>
              Disconnect
            </button>
          </div>
          <div role="radiogroup" aria-label={`${row.name} access`} className="seg inset">
            <button role="radio" aria-checked={row.access === "read"} disabled={busy === row.id} onClick={() => setAccess(row, "read")}>
              Look only
            </button>
            <button role="radio" aria-checked={row.access === "write"} disabled={busy === row.id} onClick={() => setAccess(row, "write")}>
              Add &amp; edit
            </button>
          </div>
          {hint?.id === row.id ? <p className="note" role="status">{hint.text}</p> : null}
        </div>
      ))}
    </section>
  );
}
