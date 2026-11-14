"use client";

// Remind (SE2, canvas FriendDetail): the message the person will get, when
// you last reminded them, and Send — at most once per person per 24 hours.

import * as React from "react";
import { Sheet } from "./ui";
import { Icon } from "./icons";
import { canRemind, lastRemindedText, reminderPreview } from "../lib/settle";
import { errorReason, errorText, newIdempotencyKey, useSession } from "../lib/session";

export interface RemindTarget {
  to: string;
  toName: string;
  amountMinor: number;
  currency: string;
  groupId: string | null;
  groupName: string | null;
  lastSentAt: string | null;
}

export function RemindButton({ target, onSent, compact }: { target: RemindTarget; onSent?: (sentAt: string) => void; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        className={compact ? "pillbtn" : "btn ghost flex1"}
        onClick={() => setOpen(true)}
        aria-label={`Remind ${target.toName}`}
        style={compact ? { height: 34, padding: "0 10px", fontSize: 12 } : undefined}
      >
        <Icon name="bell" size={compact ? 14 : 18} />
        Remind
      </button>
      {open ? (
        <RemindSheet
          target={target}
          onClose={() => setOpen(false)}
          onSent={(at) => {
            onSent?.(at);
          }}
        />
      ) : null}
    </>
  );
}

export function RemindSheet({ target, onClose, onSent }: { target: RemindTarget; onClose: () => void; onSent: (sentAt: string) => void }) {
  const { client } = useSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  const [last, setLast] = React.useState(target.lastSentAt);
  const key = React.useRef(newIdempotencyKey());
  const now = new Date();
  const allowed = canRemind(last, now) && !sentAt;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await client.spliteco.remind({ to: target.to, groupId: target.groupId }, { idempotencyKey: key.current });
      setSentAt(r.reminder.sentAt);
      setLast(r.reminder.sentAt);
      onSent(r.reminder.sentAt);
    } catch (err) {
      if (errorReason(err) === "reminded_recently") setError("You reminded them in the last 24 hours. Try again tomorrow.");
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet label={`Remind ${target.toName}`} onClose={onClose}>
      <h2 className="h1" style={{ fontSize: 22 }}>Remind {target.toName}</h2>
      <span className="small muted bold">Reminder {target.toName} will get</span>
      <div className="bubble" style={{ fontSize: 15, lineHeight: 1.5 }} aria-label="Message preview">
        {reminderPreview({ toName: target.toName, amountMinor: target.amountMinor, currency: target.currency, groupName: target.groupName })}
      </div>
      <span className="small dim" aria-live="polite">{lastRemindedText(last, now)}</span>
      <p className="note">By email, and as a notification if they turned those on. At most once a day.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {sentAt ? (
        <p className="okc" role="status" style={{ margin: 0, fontWeight: 500 }}>Sent. {target.toName} will hear from Spliteco.</p>
      ) : null}
      <div className="inline" style={{ flexWrap: "nowrap" }}>
        <button className="btn ghost flex1" onClick={onClose}>{sentAt ? "Done" : "Cancel"}</button>
        <button className="btn flex1" onClick={send} disabled={!allowed || busy}>
          {busy ? "Sending…" : sentAt ? "Sent" : allowed ? "Send reminder" : "Sent recently"}
        </button>
      </div>
    </Sheet>
  );
}
