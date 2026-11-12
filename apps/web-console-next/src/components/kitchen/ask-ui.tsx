"use client";

import * as React from "react";
import { Check, Hourglass, Lock, X } from "lucide-react";
import type { KitchenItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useProfile } from "./data";
import { faceColor } from "./faces";
import { memberInitials, type MemberNames } from "./members";
import type { GroupRole } from "./groups";
import { useSaveAskSetting } from "./ask-data";
import { useMembersOf } from "./pantry-data";
import {
  allowPerson,
  allowedChips,
  answererOf,
  askDraftOf,
  askExplainer,
  askModes,
  askSettingBody,
  canSetAsk,
  disallowPerson,
  firstOf,
  setAskMode,
  type AskDraft,
  type AskStatus,
} from "./ask-before-use";

/**
 * Ask before use's parts (cookpool-pantry PN-9, the canvas's AskSetting and
 * AskRequest): the ask's line on a row, the waiting box with Cancel, the
 * main "Ask Meera" button, and Who can use it — on the item page (with
 * Save) and on Add item (part of the form). Home's card is `ask-card-ui.tsx`.
 */

const TONE: Record<AskStatus["phase"], { className: string; icon: typeof Check }> = {
  waiting: { className: "text-cp-soon", icon: Hourglass },
  approved: { className: "text-cp-accent-text", icon: Check },
  declined: { className: "text-muted-foreground", icon: X },
  lapsed: { className: "text-muted-foreground", icon: Hourglass },
};

/** The row's line under its level: "Asked Meera · 1 pinch · waiting · lapses in 24 h", "Meera said yes · logged". */
export function AskStatusLine({ status, className }: { status: AskStatus; className?: string }) {
  const tone = TONE[status.phase];
  const Icon = tone.icon;
  return (
    <span role="status" className={cn("mt-1 flex min-w-0 items-center gap-1.5 text-[13px] font-normal", tone.className, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
      <span className="min-w-0 truncate">{status.text}</span>
    </span>
  );
}

/** While an ask waits (the canvas's): "Asked Meera · 1 pinch" over "Waiting · lapses in 24 h", with Cancel. */
export function AskWaitBox({ status, onCancel, className }: { status: AskStatus; onCancel: () => void; className?: string }) {
  if (status.phase !== "waiting") {
    return (
      <div className={cn("flex min-h-12 items-center gap-2.5 rounded-[14px] px-3 py-2", status.phase === "approved" ? "bg-cp-accent-tint text-cp-accent-text" : "bg-muted text-foreground/80", className)}>
        <span role="status" className="min-w-0 flex-1 text-[15px] font-medium">
          {status.title}
        </span>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[14px] bg-cp-soon-tint px-3 py-2", className)}>
      <span role="status" className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium text-cp-soon">{status.title}</span>
        <span className="text-xs font-normal text-cp-soon">{status.sub} · nothing logged yet</span>
      </span>
      {status.cancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 shrink-0 rounded-[14px] bg-card px-3.5 text-sm font-medium text-cp-soon transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/** The set row's and the sheet's one main button when you must ask: "Ask Meera", on ink (the canvas's). */
export const ASK_BUTTON =
  "flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-foreground px-3 text-base font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";

export function AskLockIcon({ className }: { className?: string }) {
  return <Lock className={cn("h-[18px] w-[18px] shrink-0", className)} strokeWidth={2.4} aria-hidden />;
}

// ── Who can use it ────────────────────────────────────────────────

const SECTION = "px-0.5 text-[15px] font-medium text-foreground";

/**
 * Who can use it (design §8.1, the canvas's AskSetting): Anyone in Flat 4B ·
 * Ask me first (radios); with Ask me first, "Never need to ask" — who is on
 * the list, each with ×, and + each other member — and the three lines that
 * say what it does. `draft` is the screen's; the caller saves it.
 */
export function AskSettingFields({
  idPrefix,
  groupName,
  draft,
  onChange,
  roster,
  answerer,
  meId,
  names,
}: {
  idPrefix: string;
  groupName: string;
  draft: AskDraft;
  onChange: (next: AskDraft) => void;
  roster: readonly string[] | null;
  /** Who answers (never on the list). */
  answerer: string | null;
  meId: string | null;
  names: MemberNames;
}) {
  const profile = useProfile();
  const myFirst = firstOf(profile.data?.displayName ?? null);
  const modes = askModes(groupName, draft.mode);
  const chips = allowedChips(draft, { roster, answerer, meId, names });
  const headingId = `${idPrefix}-who`;
  const allowId = `${idPrefix}-allow`;
  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby={headingId} className="flex flex-col gap-2">
        <h2 id={headingId} className={SECTION}>
          Who can use it
        </h2>
        <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.on}
              onClick={() => onChange(setAskMode(draft, m.id))}
              className={cn(
                "flex min-h-16 items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                m.on ? "bg-cp-accent-tint" : "bg-muted/60 hover:bg-muted",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-medium">{m.title}</span>
                <span className="text-[13px] font-normal text-muted-foreground">{m.sub}</span>
              </span>
              <span aria-hidden className={cn("grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2", m.on ? "border-primary" : "border-muted-foreground")}>
                <span className={cn("h-2.5 w-2.5 rounded-full", m.on ? "bg-primary" : "bg-transparent")} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {draft.mode === "ask" ? (
        <section aria-labelledby={allowId} className="flex flex-col gap-2">
          <h3 id={allowId} className={SECTION}>
            Never need to ask
          </h3>
          <div className="flex flex-wrap gap-2 rounded-[20px] bg-muted/40 p-3">
            {chips.allowed.map((p) => (
              <span key={p.id} className="flex min-h-11 items-center gap-1.5 rounded-full bg-cp-accent-tint pl-1.5 text-sm font-medium text-cp-accent-text">
                <span
                  aria-hidden
                  style={{ backgroundColor: faceColor(p.id, meId) }}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-medium text-primary-foreground"
                >
                  {memberInitials(p.id, meId, names)}
                </span>
                {p.name}
                <button
                  type="button"
                  aria-label={p.label}
                  onClick={() => onChange(disallowPerson(draft, p.id))}
                  className="grid h-11 w-10 place-items-center rounded-full text-cp-accent-text hover:bg-cp-accent-tint/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" strokeWidth={2.6} aria-hidden />
                </button>
              </span>
            ))}
            {chips.others.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-label={p.label}
                onClick={() => onChange(allowPerson(draft, p.id))}
                className="min-h-11 rounded-full bg-muted px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                + {p.name}
              </button>
            ))}
            {chips.allowed.length === 0 && chips.others.length === 0 ? (
              <span className="flex min-h-11 items-center px-1 text-sm font-normal text-muted-foreground">{roster === null ? "Loading the group…" : "Nobody else in the group"}</span>
            ) : null}
          </div>
          <ul className="flex list-disc flex-col gap-1.5 py-1 pl-[22px] pr-1 text-[13px] font-normal text-muted-foreground">
            {askExplainer(myFirst).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The item page's Who can use it (design §5.6, §8.1): only for its answerer
 * — the buyer, or an owner or admin once the buyer has left. Save sends the
 * change at once, with Undo; it shows once something changed.
 */
export function ItemAskSetting({
  item,
  roster,
  meId,
  names,
  role,
}: {
  item: KitchenItem;
  roster: readonly string[] | null;
  meId: string | null;
  names: MemberNames;
  role: GroupRole | null;
}) {
  if (item.pantry.kind !== "group" || !canSetAsk(item, { meId, role, roster })) return null;
  // A setting from elsewhere (Save's answer, an Undo) starts the card afresh.
  const key = `${item.askFirst ? 1 : 0}:${(item.allowed ?? []).join(",")}`;
  return <ItemAskSettingCard key={key} item={item} groupName={item.pantry.name} roster={roster} meId={meId} names={names} />;
}

function ItemAskSettingCard({ item, groupName, roster, meId, names }: { item: KitchenItem; groupName: string; roster: readonly string[] | null; meId: string | null; names: MemberNames }) {
  const [draft, setDraft] = React.useState<AskDraft>(() => askDraftOf(item));
  const save = useSaveAskSetting();
  const body = askSettingBody(draft, item, { roster, meId });
  // A viewer uses nothing, so never needs to be let in.
  const members = useMembersOf(item.pantry.kind === "group" ? item.pantry.orgId : null);
  const users = React.useMemo(() => (members.data ? members.data.filter((m) => m.role !== "viewer").map((m) => m.subjectId) : roster), [members.data, roster]);
  return (
    <div className="flex flex-col gap-3 rounded-cp-card bg-card p-4 shadow-cp-card">
      <AskSettingFields idPrefix={`ask-${item.id}`} groupName={groupName} draft={draft} onChange={setDraft} roster={users} answerer={answererOf(item, roster)} meId={meId} names={names} />
      {body ? (
        <Button type="button" className="min-h-12 w-full rounded-[14px] text-[15px] font-medium" onClick={() => void save({ item, draft, roster, meId })}>
          Save
        </Button>
      ) : null}
    </div>
  );
}
