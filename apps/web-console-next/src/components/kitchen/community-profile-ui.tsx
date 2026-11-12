"use client";

import * as React from "react";
import Link from "./link";
import { useSearchParams } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import type { PersonProfileResponse, RecipeSummary } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CLOSE_44, KCard, K_BUTTON, K_BUTTON_QUIET, K_SECTION, K_TITLE } from "./kit";
import { BackButton } from "./back-ui";
import { useProfile } from "./data";
import { useKitchenRouter } from "./transition-ui";
import { PersonRecipesView, SaveCopyChip, Segmented } from "./cook-hub-views";
import { personRecipeRows, type PersonRecipeRow } from "./explore";
import { usePrefetchRecipe } from "./recipes-data";
import { useSaveCopy } from "./recipe-travel-data";
import { copyLink } from "./recipe-share";
import {
  COMMUNITY_HREF,
  HANDLE_SETUP_HREF,
  atHandle,
  followButton,
  followedByText,
  lockText,
  parseHandleParam,
  profileCounts,
  profileFirstName,
  profileHref,
  profileInitials,
  profileListFrom,
  profileMenuText,
  profileUrl,
  type ProfileListId,
} from "./community";
import { peopleRows, type PersonRow } from "./community-people";
import { CountsRow, EmptyLine, FollowButtonView, LockCard, OUTLINE_BUTTON, PeopleList, PeopleListSkeleton, PersonRowView, ProfileFace } from "./community-views";
import { ProfileCooks } from "./community-feed-ui";
import { ReportSheet, type ReportTarget } from "./community-report-ui";
import { useBlock, useFollow, useMute, useMyCommunityProfile, usePersonProfile, useProfilePeople, useProfileRecipes, useRemoveFollower } from "./community-data";

/**
 * A cook's profile (cookpool-community CM-5, the canvas's `PersonProfile`):
 * `/u/<handle>`. Back · @handle · ⋯; the face and Posts · Recipes ·
 * Followers · Following; the name, about and "Followed by …"; Follow (Ask to
 * follow, Requested, Following) and Share; then the lock when `canSee` is
 * false, else Cooks | Recipes — or Followers / Following, opened from the
 * counts (`?list=`). The ⋯ menu mutes or blocks ("… isn't told"), each with
 * Undo.
 *
 * Cooks a week isn't shown: the app only knows the dishes of people in your
 * groups. Cooks is their posts, as the feed's cards (CM-6), and the default tab.
 */

export function PersonProfileScreen() {
  const handle = parseHandleParam(usePathParam("/u/:handle", "handle"));
  const read = usePersonProfile(handle);
  const [blocked, setBlocked] = React.useState<{ userId: string; handle: string; name: string } | null>(null);

  if (blocked) return <BlockedHere person={blocked} onUnblocked={() => setBlocked(null)} />;
  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5">
      {read.loading ? (
        <ProfileSkeleton />
      ) : !handle || read.error?.code === "not_found" ? (
        <KCard className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <h1 className={K_SECTION}>Nobody&apos;s here</h1>
          <p className="text-sm text-muted-foreground">{handle ? `No profile is called ${atHandle(handle)}.` : "That isn't a handle."}</p>
          <Button asChild className={K_BUTTON}>
            <Link href={COMMUNITY_HREF}>Community</Link>
          </Button>
        </KCard>
      ) : read.error || !read.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this profile.</p>
          <Button variant="outline" className={K_BUTTON_QUIET} onClick={read.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <ProfileBody view={read.data} onBlocked={(p) => setBlocked(p)} />
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3.5">
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-[76px] w-[76px] rounded-full" />
        <Skeleton className="h-11 flex-1 rounded-xl" />
      </div>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-12 w-full rounded-[14px]" />
    </div>
  );
}

function ProfileBody({ view, onBlocked }: { view: PersonProfileResponse; onBlocked: (p: { userId: string; handle: string; name: string } | null) => void }) {
  const { profile, relationship: rel, canSee } = view;
  const me = useProfile();
  const mine = useMyCommunityProfile();
  const hasProfile = !!mine.data?.profile;
  const router = useKitchenRouter();
  const follow = useFollow();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const list = profileListFrom(searchParams?.get("list"));
  const [menu, setMenu] = React.useState(false);
  const button = followButton(rel, profile.privacy);
  const lock = lockText(profile);
  const followedBy = followedByText(view.followedBy);

  const onFollow = () => {
    if (!hasProfile && !mine.loading) {
      toast({ kind: "warning", title: "Make your public profile first", description: "Then you can follow people" });
      router.push(HANDLE_SETUP_HREF);
      return;
    }
    void follow({ handle: profile.handle, userId: profile.userId, name: profile.name, privacy: profile.privacy, from: rel.following });
  };
  const onShare = () => {
    const url = profileUrl(window.location.origin, profile.handle);
    void copyLink(url, typeof navigator !== "undefined" ? navigator.clipboard : null).then((ok) =>
      toast(ok ? { kind: "success", title: "Link copied", description: url } : { kind: "warning", title: "Couldn't copy it", description: url }),
    );
  };

  return (
    <>
      <div className="-mx-2.5 flex min-h-11 items-center">
        <BackButton />
        <span className="min-w-0 flex-1 truncate text-center text-[15px] font-medium">{atHandle(profile.handle)}</span>
        {rel.isYou ? (
          <span aria-hidden className="h-11 w-11" />
        ) : (
          <button
            type="button"
            aria-label="More: mute, block or report"
            aria-haspopup="dialog"
            onClick={() => setMenu(true)}
            className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="h-6 w-6" strokeWidth={2.2} aria-hidden />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <ProfileFace userId={profile.userId} meId={me.data?.id ?? null} initials={profileInitials(profile)} size="lg" />
        <CountsRow cells={profileCounts(profile.handle, view.counts, canSee)} />
      </div>
      <div className="flex flex-col gap-0.5">
        <h1 className={cn(K_TITLE, "break-words")}>{profile.name}</h1>
        {profile.about ? <p className="text-sm font-normal text-muted-foreground">{profile.about}</p> : null}
        {followedBy ? <p className="text-[13px] font-normal text-muted-foreground">{followedBy}</p> : null}
        {rel.followsYou && !rel.isYou ? <p className="text-[13px] font-normal text-muted-foreground">Follows you</p> : null}
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        {rel.isYou ? <FollowButtonView button={button} href={HANDLE_SETUP_HREF} /> : <FollowButtonView button={button} onClick={onFollow} />}
        <button type="button" onClick={onShare} className={cn("min-h-12 rounded-[14px] text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", OUTLINE_BUTTON)}>
          Share
        </button>
      </div>

      {!canSee ? (
        <LockCard title={lock.title} sub={lock.sub} />
      ) : list === "followers" || list === "following" ? (
        <ProfilePeople view={view} list={list} myId={me.data?.id ?? null} hasProfile={hasProfile} />
      ) : (
        <ProfileTabs view={view} list={list} />
      )}

      {rel.isYou ? null : <ProfileMenu open={menu} onOpenChange={setMenu} view={view} onBlocked={onBlocked} />}
    </>
  );
}

/** Cooks | Recipes; the choice stays in the address. */
function ProfileTabs({ view, list }: { view: PersonProfileResponse; list: ProfileListId }) {
  const router = useKitchenRouter();
  const handle = view.profile.handle;
  const recipes = useProfileRecipes(handle, list === "recipes");
  const rows = React.useMemo(() => personRecipeRows(recipes.data?.recipes ?? []), [recipes.data]);
  const byId = React.useMemo(() => new Map((recipes.data?.recipes ?? []).map((r) => [r.id, r] as const)), [recipes.data]);
  const prefetch = usePrefetchRecipe();
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Show"
        large
        value={list === "cooks" ? "cooks" : "recipes"}
        onChange={(next) => {
          if (next !== list) router.replace(profileHref(handle, next), { scroll: false });
        }}
        options={[
          { id: "cooks", label: "Cooks" },
          { id: "recipes", label: "Recipes" },
        ]}
      />
      {list === "cooks" ? (
        <ProfileCooks handle={handle} />
      ) : (
        <PersonRecipesView
          rows={rows}
          loading={recipes.loading}
          failed={!!recipes.error && !recipes.data}
          onReload={recipes.reload}
          prefetch={prefetch}
          renderSave={
            view.relationship.isYou
              ? undefined
              : (row) => {
                  const recipe = byId.get(row.id);
                  return recipe ? <ProfileRecipeSave row={row} recipe={recipe} /> : null;
                }
          }
        />
      )}
    </div>
  );
}

/** Save on one of their public recipes: your own copy. */
function ProfileRecipeSave({ row, recipe }: { row: PersonRecipeRow; recipe: RecipeSummary }) {
  const copy = useSaveCopy(recipe);
  return <SaveCopyChip name={row.name} savedId={copy.savedId} saving={copy.saving} onSave={copy.save} />;
}

/** Followers or Following, opened from the counts; × goes back to the tabs. Your own followers each have Remove. */
function ProfilePeople({ view, list, myId, hasProfile }: { view: PersonProfileResponse; list: "followers" | "following"; myId: string | null; hasProfile: boolean }) {
  const handle = view.profile.handle;
  const page = useProfilePeople(handle, list, true);
  const rows = React.useMemo(() => peopleRows(page.data), [page.data]);
  const onFollow = useFollowRow(hasProfile);
  const remove = useRemoveFollower();
  const title = list === "followers" ? "Followers" : "Following";
  return (
    <section aria-labelledby="people-h" className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between">
        <h2 id="people-h" className="text-lg font-medium tracking-tight">
          {title}
        </h2>
        <Link href={profileHref(handle)} aria-label={`Close ${title}`} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-5 w-5" aria-hidden />
        </Link>
      </div>
      {page.loading ? (
        <PeopleListSkeleton />
      ) : page.error && !page.data ? (
        <EmptyLine>Couldn&apos;t load them.</EmptyLine>
      ) : rows.length === 0 ? (
        <EmptyLine>{list === "followers" ? "No followers yet" : "Not following anyone yet"}</EmptyLine>
      ) : (
        <PeopleList label={title}>
          {rows.map((row) =>
            row.userId === myId ? (
              <PersonRowView key={row.userId} row={{ ...row, sub: `${row.sub} · you` }} />
            ) : view.relationship.isYou && list === "followers" ? (
              <PersonRowView
                key={row.userId}
                row={row}
                action={
                  <button type="button" onClick={() => remove(row)} className={cn("min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", OUTLINE_BUTTON)}>
                    Remove<span className="sr-only"> {row.name}</span>
                  </button>
                }
              />
            ) : (
              <PersonRowView key={row.userId} row={row} onFollow={onFollow} />
            ),
          )}
        </PeopleList>
      )}
    </section>
  );
}

/** Follow from a list's row, with Undo; without a profile, HandleSetup first. */
export function useFollowRow(hasProfile: boolean) {
  const follow = useFollow();
  const router = useKitchenRouter();
  const { toast } = useToast();
  return React.useCallback(
    (row: PersonRow) => {
      if (!hasProfile) {
        toast({ kind: "warning", title: "Make your public profile first", description: "Then you can follow people" });
        router.push(HANDLE_SETUP_HREF);
        return;
      }
      void follow({ handle: row.handle, userId: row.userId, name: row.name, privacy: row.private ? "private" : "public", from: row.following });
    },
    [follow, hasProfile, router, toast],
  );
}

/** ⋯: Mute (or Unmute) their posts, Block @handle, and that they aren't told; Report @handle (CM-6). */
function ProfileMenu({
  open,
  onOpenChange,
  view,
  onBlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: PersonProfileResponse;
  onBlocked: (p: { userId: string; handle: string; name: string } | null) => void;
}) {
  const { profile, relationship: rel } = view;
  const words = profileMenuText(profile, rel.muted);
  const mute = useMute();
  const block = useBlock();
  const [report, setReport] = React.useState<ReportTarget | null>(null);
  const item = "min-h-[52px] w-full rounded-[14px] text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={cn("mx-auto max-w-xl gap-2 rounded-t-[24px] border-x-0 bg-card px-5 pb-6 pt-3 min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border", CLOSE_44)}
        >
          <div aria-hidden className="mx-auto mb-1 h-[5px] w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
          <SheetTitle className="flex min-h-11 items-center pr-12 text-lg font-medium">{profileFirstName(profile)}</SheetTitle>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                mute(profile, !rel.muted);
              }}
              className={cn(item, "bg-secondary hover:bg-accent")}
            >
              {words.mute}
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onBlocked({ userId: profile.userId, handle: profile.handle, name: profile.name });
                // Undone, or refused: the profile comes back.
                block(profile, true, (stands) => {
                  if (!stands) onBlocked(null);
                });
              }}
              className={cn(item, "bg-cp-expired-tint text-destructive hover:bg-cp-expired-tint/80")}
            >
              {words.block}
            </button>
            <p className="text-center text-[13px] font-normal text-muted-foreground">{words.blockNote}</p>
            {/* CM-6: reports exist now. */}
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                setReport({ kind: "profile", id: profile.userId, handle: profile.handle });
              }}
              className={cn(item, "bg-secondary hover:bg-accent")}
            >
              Report {atHandle(profile.handle)}
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </>
  );
}

/** Right after Block: who, that they aren't told, and Unblock (the toast's Undo does the same). */
function BlockedHere({ person, onUnblocked }: { person: { userId: string; handle: string; name: string }; onUnblocked: () => void }) {
  const block = useBlock();
  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5">
      <div className="-ml-2.5 flex min-h-11 items-center">
        <BackButton />
      </div>
      <KCard className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <h1 className="text-lg font-medium">You blocked {atHandle(person.handle)}</h1>
        <p className="text-sm font-normal text-muted-foreground">You won&apos;t see each other anywhere. {profileFirstName(person)} isn&apos;t told.</p>
        <button
          type="button"
          onClick={() => block(person, false, (stands) => stands && onUnblocked())}
          className={cn("mt-2 min-h-11 rounded-xl px-5 text-[15px] font-medium", OUTLINE_BUTTON)}
        >
          Unblock
        </button>
      </KCard>
    </div>
  );
}
