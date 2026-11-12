"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Mail, Pencil } from "lucide-react";
import type { AuthUser } from "@saas/contracts/auth";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { lastSignInMethod } from "@/lib/first-run";
import { signOutOfThisDevice } from "@/lib/sign-out";
import { isOffline } from "@/lib/connection";
import { forgetThisDevicePush } from "@/lib/push-device";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { applyNewName, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_CARD, K_QUIET } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { InstallRow } from "@/components/kitchen/install-ui";
import { NotificationsRow } from "@/components/kitchen/notify-ui";
import { AiSettingsRow } from "@/components/kitchen/ai-settings-ui";
import { SecurityRow } from "@/components/kitchen/passkey-ui";
import { newFrame } from "@/lib/features";
import { GoogleMark, NoticeBox, PersonAvatar, SIGN_IN_INPUT } from "@/components/kitchen/sign-in-ui";
import { NAME_LABEL, NAME_MAX, cleanDisplayName, namePrefill, saveNameOutcome, type SignInNotice } from "@/components/kitchen/sign-in";
import {
  CHANGE_NAME,
  HOW_YOU_SIGN_IN,
  LAST_USED,
  SIGN_OUT_DEVICE,
  SIGN_OUT_PHONE,
  YOU_TITLE,
  nameToSave,
  personInitials,
  shownName,
  signInRows,
} from "@/components/kitchen/you";

/**
 * You (Cookpool SI-6, design §7, the `Account` artboard; SM-15 under the
 * seven rules — no sentences under the name or under sign-out, "Last used"
 * only when there is a choice): your initials, name and email; "Change your
 * name" in place (Save · Cancel), which every group sees at once; "How you
 * sign in"; and "Sign out of this phone", which ends this device's session
 * and opens the sign-in page.
 *
 * Home's avatar opens it on a phone, the sidebar's "Me" from 900px; the
 * phone tab bar is unchanged. Sign out works even when the profile cannot be
 * read.
 *
 * "Install the app" (cookpool-app PW-2) sits above sign-out: the same flow
 * as Home's card, there any time, and gone in the installed app.
 *
 * "Notifications" (PW-6) opens You → Notifications; signing out removes this
 * device's push subscription first (`forgetPush`).
 *
 * Since cookpool-recipes RC-2 this is today's `/you` (what prod shows) and,
 * in the new frame, `/you/settings`, which You's gear opens: there it is
 * titled Settings and has its Back at every width (it is under You, not a
 * destination of its own).
 */
export function YouSettings({ title = YOU_TITLE, sub = false }: { title?: string; sub?: boolean } = {}) {
  const profile = useProfile();
  const user = profile.data;

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 min-[900px]:gap-5">
      <header className="flex items-center gap-2">
        {/* From 900px You is the sidebar's "Me", a destination like the tabs: no Back there. */}
        <BackButton className={sub ? undefined : "min-[900px]:hidden"} />
        <h1 className="text-2xl font-medium tracking-[-0.02em] min-[900px]:text-[26px]">{title}</h1>
      </header>

      {profile.loading ? (
        <MeSkeleton />
      ) : user ? (
        <>
          <MeCard user={user} />
          <SignInWays email={user.email} />
          {/* You → Sign-in and security (PK-4), only where passkeys run. */}
          <SecurityRow />
        </>
      ) : (
        <KCard className="flex flex-wrap items-center justify-between gap-3 rounded-3xl p-5">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Couldn&apos;t load your name</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{profile.error?.message ?? "Try again in a moment."}</p>
          </div>
          <Button variant="outline" className={K_BUTTON} onClick={profile.reload}>
            Try again
          </Button>
        </KCard>
      )}

      <NotificationsRow />

      {/* You → Cookpool AI (cookpool-ai AI-7), in the new frame only. */}
      {newFrame() ? <AiSettingsRow /> : null}

      <InstallRow />

      <SignOut />
    </div>
  );
}

/** Today's frame's outlined secondary button (prod). */
const OUTLINED = "border-border bg-card text-foreground hover:bg-accent";

export function MeCard({ user }: { user: AuthUser }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<SignInNotice | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const editButtonRef = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef(false);
  const name = shownName(user);
  // The new frame's Name and handle (RV-18): quiet tint buttons, no outline. Today's You keeps its outlined ones.
  const quiet = newFrame();

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const startEdit = () => {
    // No name yet: start from the same guess as the Name step.
    setDraft(user.displayName ?? namePrefill(user.email));
    setNotice(null);
    setEditing(true);
  };

  const close = () => {
    returnFocus.current = true;
    setEditing(false);
    setNotice(null);
  };

  const save = async () => {
    const next = nameToSave(user.displayName, draft);
    if (next === null) {
      // The same name: nothing to send.
      if (cleanDisplayName(draft) !== "") close();
      return;
    }
    setSaving(true);
    setNotice(null);
    const r = await wrap(() => client.auth.updateProfile({ displayName: next }));
    setSaving(false);
    if (r.ok) {
      // The profile in place, and every read that carries names refreshed (CP-9).
      applyNewName(qc, r.data.user);
      close();
      toast({ kind: "success", title: `Saved · ${shownName(r.data.user)}` });
      return;
    }
    const outcome = saveNameOutcome(r.error, r.status);
    // A 401 has already sent the person to sign-in (the kitchen layout).
    if (outcome.kind === "refused") setNotice(outcome.notice);
  };

  const canSave = !saving && cleanDisplayName(draft) !== "";
  const noticeId = notice ? "you-name-notice" : undefined;

  return (
    <section aria-labelledby="you-name" className={cn(K_CARD, "flex flex-col gap-4 p-5")}>
      <div className="flex items-center gap-3.5">
        <PersonAvatar initials={personInitials(user)} className="h-[60px] w-[60px] text-[22px]" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="you-name" className="text-xl font-medium [overflow-wrap:anywhere]">
            {name}
          </h2>
          <span className="truncate text-sm text-muted-foreground">{user.email}</span>
        </div>
      </div>

      {editing ? (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save();
          }}
        >
          <label htmlFor="you-name-field" className="text-sm font-medium">
            {NAME_LABEL}
          </label>
          <input
            ref={inputRef}
            id="you-name-field"
            name="name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            maxLength={NAME_MAX}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !saving) {
                e.preventDefault();
                close();
              }
            }}
            aria-invalid={notice ? true : undefined}
            aria-describedby={noticeId}
            className={cn(SIGN_IN_INPUT, "h-[50px]")}
          />
          {notice ? <NoticeBox id={noticeId} notice={notice} /> : null}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={close}
              className={cn("h-[46px] rounded-[14px] text-[15px] font-medium", quiet ? K_QUIET : OUTLINED)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave} loading={saving} className="h-[46px] rounded-[14px] text-[15px] font-medium">
              Save
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={editButtonRef}
          type="button"
          variant="outline"
          onClick={startEdit}
          className={cn("h-[46px] gap-2 rounded-[14px] text-[15px] font-medium", quiet ? K_QUIET : OUTLINED)}
        >
          <Pencil className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
          {CHANGE_NAME}
        </Button>
      )}
    </section>
  );
}

function SignInWays({ email }: { email: string }) {
  // Read once: every sign-in on this device overwrites it, and You is reached signed in.
  const [last] = React.useState(lastSignInMethod);
  // A passkey sign-in (PK-4) is listed under Sign-in and security, not here.
  const rows = signInRows(email, last === "passkey" ? null : last);
  return (
    <section aria-labelledby="you-how" className="rounded-cp-card bg-card shadow-cp-card px-5 py-1.5">
      <h2 id="you-how" className="mb-1.5 mt-3.5 text-[13px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {HOW_YOU_SIGN_IN}
      </h2>
      <ul>
        {rows.map((row, i) => (
          <li
            key={row.way}
            className={cn("flex min-h-14 items-center gap-3 py-2", i < rows.length - 1 && "border-b border-cp-line")}
          >
            {row.way === "google" ? (
              <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border-[1.5px] border-border">
                <GoogleMark className="h-4 w-4" />
              </span>
            ) : (
              <Mail className="h-[30px] w-[30px] shrink-0 text-foreground" strokeWidth={1.6} aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-[15px] font-medium [overflow-wrap:anywhere]">{row.label}</span>
            {row.lastUsed ? (
              <span className="shrink-0 rounded-full bg-cp-herb-tint px-2.5 py-1 text-[13px] font-medium text-cp-accent-text">{LAST_USED}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sign out of this device: this device's push first, then the session, the cache, and the sign-in page. */
export function useSignOut(): { busy: boolean; signOut: () => void } {
  const { client, setToken } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const signOut = () => {
    if (busy) return;
    setBusy(true);
    void signOutOfThisDevice({
      forgetPush: () => forgetThisDevicePush((endpoint) => client.notifications.unsubscribePush(endpoint), isOffline()),
      logout: () => client.auth.logout(),
      setToken,
      clearCache: () => qc.clear(),
      go: (path) => window.location.replace(path),
    });
  };
  return { busy, signOut };
}

function SignOut() {
  const { busy, signOut } = useSignOut();

  return (
    <section aria-labelledby="you-out" className="flex flex-col gap-2.5 pt-1">
      <h2 id="you-out" className="sr-only">
        Sign out
      </h2>
      <Button
        type="button"
        variant="outline"
        loading={busy}
        onClick={signOut}
        className="h-[54px] gap-2.5 rounded-2xl border-border bg-card text-base font-medium text-destructive hover:bg-cp-expired-tint hover:text-destructive"
      >
        {busy ? null : <LogOut className="h-5 w-5" strokeWidth={2} aria-hidden />}
        <span className="min-[900px]:hidden">{SIGN_OUT_PHONE}</span>
        <span className="hidden min-[900px]:inline">{SIGN_OUT_DEVICE}</span>
      </Button>
    </section>
  );
}

function MeSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-cp-card bg-card shadow-cp-card p-5">
        <div className="flex items-center gap-3.5">
          <Skeleton className="h-[60px] w-[60px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-52 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-[46px] w-full rounded-[14px]" />
      </div>
      <Skeleton className="h-36 w-full rounded-3xl" />
    </div>
  );
}
