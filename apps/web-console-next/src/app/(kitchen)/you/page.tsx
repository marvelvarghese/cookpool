"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, LogOut, Mail, Pencil } from "lucide-react";
import type { AuthUser } from "@saas/contracts/auth";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { lastSignInMethod } from "@/lib/first-run";
import { signOutOfThisDevice } from "@/lib/sign-out";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { applyNewName, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import { GoogleMark, NoticeBox, PersonAvatar, SIGN_IN_INPUT } from "@/components/kitchen/sign-in-ui";
import { NAME_LABEL, NAME_MAX, cleanDisplayName, namePrefill, saveNameOutcome, type SignInNotice } from "@/components/kitchen/sign-in";
import {
  CHANGE_NAME,
  HOW_YOU_SIGN_IN,
  LAST_USED,
  NAME_NOTE,
  SIGN_OUT_DEVICE,
  SIGN_OUT_PHONE,
  STAY_AS_THEY_ARE,
  YOU_TITLE,
  nameToSave,
  personInitials,
  shownName,
  signInRows,
} from "@/components/kitchen/you";

/**
 * You (Cookpool SI-6, design §7, the `Account` artboard): your initials, name
 * and email; "Change your name" in place (Save · Cancel), which every group
 * sees at once; "How you sign in"; and "Sign out of this phone", which ends
 * this device's session and opens the sign-in page. Your groups, pantry and
 * balances stay as they are.
 *
 * Home's avatar opens it on a phone, the sidebar's "Me" from 900px; the
 * phone tab bar is unchanged. Sign out works even when the profile cannot be
 * read.
 */
export default function YouPage() {
  const profile = useProfile();
  const user = profile.data;

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 min-[900px]:gap-5">
      <header className="flex items-center gap-2">
        <Link
          href="/home"
          aria-label="Back to Home"
          className="-ml-2.5 grid h-11 w-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[900px]:hidden"
        >
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
        </Link>
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] min-[900px]:text-[26px]">{YOU_TITLE}</h1>
      </header>

      {profile.loading ? (
        <MeSkeleton />
      ) : user ? (
        <>
          <MeCard user={user} />
          <SignInWays email={user.email} />
        </>
      ) : (
        <KCard className="flex flex-wrap items-center justify-between gap-3 rounded-3xl p-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold">Couldn&apos;t load your name</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{profile.error?.message ?? "Try again in a moment."}</p>
          </div>
          <Button variant="outline" className={K_BUTTON} onClick={profile.reload}>
            Try again
          </Button>
        </KCard>
      )}

      <SignOut />
    </div>
  );
}

function MeCard({ user }: { user: AuthUser }) {
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
      toast({ kind: "success", title: "Name saved", description: `Your groups see “${shownName(r.data.user)}”.` });
      return;
    }
    const outcome = saveNameOutcome(r.error, r.status);
    // A 401 has already sent the person to sign-in (the kitchen layout).
    if (outcome.kind === "refused") setNotice(outcome.notice);
  };

  const canSave = !saving && cleanDisplayName(draft) !== "";
  const noticeId = notice ? "you-name-notice" : undefined;

  return (
    <section aria-labelledby="you-name" className="flex flex-col gap-4 rounded-3xl border bg-card p-5">
      <div className="flex items-center gap-3.5">
        <PersonAvatar initials={personInitials(user)} className="h-[60px] w-[60px] text-[22px]" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="you-name" className="text-xl font-extrabold [overflow-wrap:anywhere]">
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
          <label htmlFor="you-name-field" className="text-sm font-bold">
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
              className="h-[46px] rounded-[14px] border-[#D5DAD2] bg-card text-[15px] font-bold text-foreground hover:bg-accent"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave} loading={saving} className="h-[46px] rounded-[14px] text-[15px] font-extrabold">
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
          className="h-[46px] gap-2 rounded-[14px] border-[#D5DAD2] bg-card text-[15px] font-bold text-foreground hover:bg-accent"
        >
          <Pencil className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
          {CHANGE_NAME}
        </Button>
      )}

      <p className="text-[13px] text-muted-foreground">{NAME_NOTE}</p>
    </section>
  );
}

function SignInWays({ email }: { email: string }) {
  // Read once: every sign-in on this device overwrites it, and You is reached signed in.
  const [last] = React.useState(lastSignInMethod);
  const rows = signInRows(email, last);
  return (
    <section aria-labelledby="you-how" className="rounded-3xl border bg-card px-5 py-1.5">
      <h2 id="you-how" className="mb-1.5 mt-3.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {HOW_YOU_SIGN_IN}
      </h2>
      <ul>
        {rows.map((row, i) => (
          <li
            key={row.way}
            className={cn("flex min-h-14 items-center gap-3 py-2", i < rows.length - 1 && "border-b border-[#ECEEE9]")}
          >
            {row.way === "google" ? (
              <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border-[1.5px] border-[#D5DAD2]">
                <GoogleMark className="h-4 w-4" />
              </span>
            ) : (
              <Mail className="h-[30px] w-[30px] shrink-0 text-foreground" strokeWidth={1.6} aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-[15px] font-semibold [overflow-wrap:anywhere]">{row.label}</span>
            {row.lastUsed ? (
              <span className="shrink-0 rounded-full bg-cp-herb-tint px-2.5 py-1 text-[13px] font-bold text-[#165C3A]">{LAST_USED}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SignOut() {
  const { client, setToken } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const signOut = () => {
    if (busy) return;
    setBusy(true);
    void signOutOfThisDevice({
      logout: () => client.auth.logout(),
      setToken,
      clearCache: () => qc.clear(),
      go: (path) => window.location.replace(path),
    });
  };

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
        className="h-[54px] gap-2.5 rounded-2xl border-[#D5DAD2] bg-card text-base font-extrabold text-destructive hover:bg-cp-expired-tint hover:text-destructive"
      >
        {busy ? null : <LogOut className="h-5 w-5" strokeWidth={2} aria-hidden />}
        <span className="min-[900px]:hidden">{SIGN_OUT_PHONE}</span>
        <span className="hidden min-[900px]:inline">{SIGN_OUT_DEVICE}</span>
      </Button>
      <p className="text-center text-[13px] text-muted-foreground">{STAY_AS_THEY_ARE}</p>
    </section>
  );
}

function MeSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-3xl border bg-card p-5">
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
