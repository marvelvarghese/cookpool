"use client";

import * as React from "react";
import Link from "./link";
import { ChevronRight } from "lucide-react";
import { PROFILE_ABOUT_MAX, PROFILE_NAME_MAX, normalizeHandle } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { BackButton } from "./back-ui";
import { useSettled } from "./recipe-ui";
import {
  BLOCKED_HREF,
  HANDLE_CHECK_MS,
  HANDLE_SETUP_SUB,
  HANDLE_SETUP_TITLE,
  PRIVACY_MODES,
  canSaveProfile,
  draftChanged,
  handleNote,
  profileDraft,
  profileHref,
  saveProfileRequest,
  saveRefusalText,
  shouldCheckHandle,
  type ProfileDraft,
} from "./community";
import { HandleNoteView, PrivacyRow, SectionLabel } from "./community-views";
import { K_TITLE } from "./kit";
import { useBlocks, useHandleAvailability, useMyCommunityProfile, useSaveMyProfile } from "./community-data";

/**
 * HandleSetup (cookpool-community CM-5, the canvas's `HandleSetup`):
 * `/you/profile`, and Community the first time it opens without a profile.
 * "Your public profile" — Name; Handle, checked as you type ("@meeracooks is
 * yours · you can change it once a month", taken, reserved, its shape, or
 * too soon with the date); About · optional; Who can follow you (Anyone ·
 * People I approve); Blocked people; Save.
 */

// RV-18: labels as Sign in's (14 px, Medium, not uppercase); fields with the boards' 1.5 px field line.
const FIELD_LABEL = "text-sm font-medium text-foreground";
const FIELD = "h-12 rounded-[14px] border-[1.5px] border-input bg-card text-base";

export function HandleSetupScreen() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="-ml-2.5 flex min-h-11 items-center">
        <BackButton />
      </div>
      <HandleSetup />
    </div>
  );
}

export function HandleSetup({
  intro = false,
  onSaved,
  onLater,
}: {
  /** In Community, the first time: "Not now" beside Save, and no Blocked people. */
  intro?: boolean;
  /** After the save landed (Community shows itself). */
  onSaved?: (() => void) | undefined;
  onLater?: (() => void) | undefined;
}) {
  const mine = useMyCommunityProfile();
  const user = useProfile();
  if (mine.loading || user.loading) {
    return (
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-12 w-full rounded-[14px]" />
        <Skeleton className="h-12 w-full rounded-[14px]" />
      </div>
    );
  }
  if (mine.error && !mine.data) {
    return (
      <p className="rounded-cp-card bg-card shadow-cp-card p-4 text-sm text-muted-foreground">
        Couldn&apos;t load your profile.{" "}
        <button type="button" onClick={mine.reload} className="min-h-11 font-medium text-primary hover:underline">
          Try again
        </button>
      </p>
    );
  }
  return <HandleSetupForm key={mine.data?.profile ? "mine" : "new"} intro={intro} onSaved={onSaved} onLater={onLater} groupName={user.data?.displayName ?? null} />;
}

function HandleSetupForm({
  intro,
  onSaved,
  onLater,
  groupName,
}: {
  intro: boolean;
  onSaved?: (() => void) | undefined;
  onLater?: (() => void) | undefined;
  groupName: string | null;
}) {
  const mine = useMyCommunityProfile();
  const profile = mine.data?.profile ?? null;
  const save = useSaveMyProfile();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<ProfileDraft>(() => profileDraft(profile, groupName));
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [now] = React.useState(() => new Date());
  const current = profile?.handle ?? null;
  const settled = useSettled(normalizeHandle(draft.handle), HANDLE_CHECK_MS);
  const availability = useHandleAvailability(settled, shouldCheckHandle(settled, current));
  const note = handleNote({ typed: draft.handle, current, nextChangeAt: profile?.nextHandleChangeAt ?? null, availability: availability.data, now });
  const changed = draftChanged(draft, profile);
  const ready = canSaveProfile(draft, note) && changed && !saving;

  const edit = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
    setRefusal(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    const r = await save(saveProfileRequest(draft));
    setSaving(false);
    if (!r.ok) {
      setRefusal(saveRefusalText(r.error, draft.handle, new Date()));
      return;
    }
    setSaved(true);
    toast({ kind: "success", title: profile ? "Profile saved" : "You're on Community", description: `@${r.data.profile?.handle ?? ""}` });
    onSaved?.();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className={K_TITLE}>{HANDLE_SETUP_TITLE}</h1>
        <p className="text-sm font-normal text-muted-foreground">{HANDLE_SETUP_SUB}</p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>Name</span>
        <Input value={draft.name} maxLength={PROFILE_NAME_MAX} autoComplete="name" onChange={(e) => edit({ name: e.target.value })} className={FIELD} />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="handle-input" className={FIELD_LABEL}>
          Handle
        </label>
        <span
          className={cn(
            "flex h-12 items-center rounded-[14px] border-[1.5px] bg-card px-3.5 focus-within:ring-2 focus-within:ring-ring",
            note.tone === "ok" ? "border-primary" : note.tone === "bad" ? "border-destructive" : "border-input",
          )}
        >
          <span aria-hidden className="text-base font-normal text-muted-foreground">
            @
          </span>
          <input
            id="handle-input"
            value={draft.handle}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={21}
            aria-describedby="handle-note"
            onChange={(e) => edit({ handle: e.target.value.replace(/^@/, "").toLowerCase() })}
            className="min-w-0 flex-1 bg-transparent text-base font-normal outline-none"
          />
        </span>
        <HandleNoteView id="handle-note" note={refusal ? { text: refusal, tone: "bad" } : note} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>About · optional</span>
        <Textarea
          rows={2}
          value={draft.about}
          maxLength={PROFILE_ABOUT_MAX}
          placeholder="What do you cook?"
          onChange={(e) => edit({ about: e.target.value })}
          className="resize-none rounded-[14px] border-[1.5px] border-input bg-card text-[15px]"
        />
      </label>

      <section aria-labelledby="privacy-h" className="flex flex-col gap-2">
        <SectionLabel id="privacy-h">Who can follow you</SectionLabel>
        <div role="radiogroup" aria-labelledby="privacy-h" className="flex flex-col gap-2">
          {PRIVACY_MODES.map((m) => (
            <PrivacyRow key={m.id} title={m.title} sub={m.sub} on={draft.privacy === m.id} onPick={() => edit({ privacy: m.id })} />
          ))}
        </div>
      </section>

      {intro ? null : <BlockedLink />}
      {profile && !intro ? (
        <Link href={profileHref(profile.handle)} className="flex min-h-11 items-center px-1 text-[15px] font-medium text-cp-accent-text hover:underline">
          See your profile
        </Link>
      ) : null}

      <button
        type="submit"
        disabled={!ready && !saved}
        className="mt-1 min-h-[60px] w-full rounded-[18px] bg-primary text-[17px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
      </button>
      {intro && onLater ? (
        <button type="button" onClick={onLater} className="min-h-11 text-[15px] font-medium text-muted-foreground hover:text-foreground">
          Not now
        </button>
      ) : null}
    </form>
  );
}

/** "Blocked people  1 ›", opening the list with Unblock. */
function BlockedLink() {
  const blocks = useBlocks();
  const count = blocks.data?.blocks.length ?? null;
  return (
    <Link
      href={BLOCKED_HREF}
      className="flex min-h-12 items-center justify-between rounded-[14px] bg-card px-3.5 text-[15px] font-medium shadow-cp-card transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Blocked people
      <span className="flex items-center gap-0.5 tabular-nums text-muted-foreground">
        {count ?? ""}
        <ChevronRight className="h-5 w-5" aria-hidden />
      </span>
    </Link>
  );
}
