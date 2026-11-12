"use client";

import * as React from "react";
import Link from "./link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ROW_TITLE, cannotInstallLine } from "@/lib/install";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "./data";
import { KCard, K_BUTTON, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { BackButton } from "./back-ui";
import { PersonAvatar } from "./sign-in-ui";
import { usePasskeysHere } from "./passkey-ui";
import { IosInstallSheet, useInstall } from "./install-ui";
import { useMyCommunityProfile } from "./community-data";
import { YouCommunity } from "./community-ui";
import { MeCard, useSignOut } from "./you-settings-ui";
import { NAME_AND_HANDLE, SIGN_OUT, personInitials, shownName, youGroups, youSubline, type YouGroup } from "./you";

/**
 * You in the new look (cookpool-revamp RV-6, the `RvYou` board), in the new
 * frame: your avatar, name and @handle; then short grouped lists — Account,
 * Sign-in and security, Cookpool AI, Notifications, and This phone's Install
 * when there is something to install — each row a label and a chevron; and
 * Sign out as quiet red text. Every row opens a page the app already had.
 * Today's frame (prod) keeps `YouSettings`.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ROW = cn("flex min-h-[54px] w-full items-center gap-3 pl-4 pr-3.5 text-left text-base font-normal text-foreground transition-colors hover:bg-accent", FOCUS);
const CHEVRON = <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />;

export function YouHome() {
  const profile = useProfile();
  const mine = useMyCommunityProfile();
  const { runs } = usePasskeysHere();
  const user = profile.data;
  const handle = mine.data?.profile?.handle ?? null;
  const groups = youGroups({ passkeys: runs === true });

  return (
    <div className="flex w-full max-w-xl flex-col gap-[22px] pb-4">
      <header className="flex items-center gap-3.5">
        {user ? (
          <PersonAvatar initials={personInitials(user)} className="h-16 w-16 text-[26px] font-medium" />
        ) : (
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {profile.loading ? (
            <Skeleton className="h-7 w-40" />
          ) : (
            <h1 className={cn(K_TITLE, "truncate")}>{user ? shownName(user) : "You"}</h1>
          )}
          {user ? <span className="truncate text-sm font-normal text-muted-foreground">{youSubline(handle, user.email)}</span> : null}
        </div>
      </header>

      {profile.error && !user ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your name.</p>
          <Button variant="outline" className={K_BUTTON} onClick={profile.reload}>
            Try again
          </Button>
        </KCard>
      ) : null}

      {groups.map((g) => (
        <YouRowGroup key={g.id} group={g} />
      ))}
      <InstallGroup />

      <YouSignOut />
    </div>
  );
}

function YouRowGroup({ group, children }: { group: Pick<YouGroup, "id" | "title"> & { rows: YouGroup["rows"] }; children?: React.ReactNode }) {
  const id = `you-${group.id}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className={K_SECTION}>
        {group.title}
      </h2>
      <ul className={K_ROWS}>
        {group.rows.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className={ROW}>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {CHEVRON}
            </Link>
          </li>
        ))}
        {children}
      </ul>
    </section>
  );
}

/** This phone: Install the app (PW-2's flow), only while there is something to install. */
function InstallGroup() {
  const { way, userAgent, prompt } = useInstall();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  if (way === null || way === "installed") return null;
  const line = cannotInstallLine(way);
  return (
    <YouRowGroup group={{ id: "phone", title: "This phone", rows: [] }}>
      <li>
        {line ? (
          <div className="flex min-h-[54px] items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-base">{ROW_TITLE}</span>
            <span className="max-w-[55%] truncate text-[13px] text-muted-foreground">{line}</span>
          </div>
        ) : (
          <button type="button" onClick={() => (way === "ios" ? setSheetOpen(true) : void prompt())} className={ROW}>
            <span className="min-w-0 flex-1 truncate">{ROW_TITLE}</span>
            {CHEVRON}
          </button>
        )}
        {way === "ios" ? <IosInstallSheet open={sheetOpen} onOpenChange={setSheetOpen} userAgent={userAgent} /> : null}
      </li>
    </YouRowGroup>
  );
}

/** Sign out: quiet red text, centred; it ends this device's session as before. */
function YouSignOut() {
  const { busy, signOut } = useSignOut();
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-h-11 items-center gap-2 self-center rounded-xl px-4 text-base font-medium text-destructive hover:bg-cp-expired-tint disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {busy ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {SIGN_OUT}
    </button>
  );
}

/**
 * Name and handle (`/you/settings` in the new frame): the name your groups
 * see, with Change your name, and your public profile's @handle, counts and
 * Edit (HandleSetup), with follow requests when it is private.
 */
export function YouNameScreen() {
  const profile = useProfile();
  const user = profile.data;
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <header className="flex items-center gap-1">
        <BackButton />
        <h1 className={K_TITLE}>{NAME_AND_HANDLE}</h1>
      </header>
      {profile.loading ? (
        <Skeleton aria-hidden className="h-40 w-full rounded-cp-card" />
      ) : user ? (
        <MeCard user={user} />
      ) : (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">{profile.error?.message ?? "Couldn't load your name."}</p>
          <Button variant="outline" className={K_BUTTON} onClick={profile.reload}>
            Try again
          </Button>
        </KCard>
      )}
      <YouCommunity />
    </div>
  );
}
