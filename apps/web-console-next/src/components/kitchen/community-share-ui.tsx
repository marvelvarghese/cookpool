"use client";

import * as React from "react";
import Link from "./link";
import { Camera, Share2 } from "lucide-react";
import type { KitchenDish, PostAudience } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CLOSE_44, K_BUTTON, K_BUTTON_QUIET } from "./kit";
import { useKitchenRouter } from "./transition-ui";
import { mainAmountMilli, mainLineOf } from "./recipes";
import { useRecipe } from "./recipes-data";
import { HANDLE_SETUP_HREF, postHref } from "./community";
import { SectionLabel } from "./community-views";
import { useMyCommunityProfile, usePersonProfile } from "./community-data";
import { useCreatePost } from "./community-posts-data";
import type { CookGuide } from "./cook-guide-draft";
import {
  CAPTION_PLACEHOLDER,
  NEVER_SHOWN,
  NOT_NOW_TOAST,
  PHOTO_SOON,
  PICK_HANDLE_TO_SHARE,
  POST_CAPTION_MAX,
  SHARED_POSTS_KEY,
  SHARE_TITLE,
  audienceOptions,
  composerRecipeLine,
  createPostRequest,
  parseSharedPosts,
  parseStepSeed,
  postButtonLabel,
  postRefusal,
  postedToast,
  previewOf,
  shareDefaults,
  shareTopLine,
  showRows,
  stepSeedKey,
  stepSeedOf,
  withSharedPost,
  type ShareDraft,
} from "./community-share";

/**
 * Share this cook? (cookpool-community CM-6, the canvas's `ShareCook`): a
 * tall sheet over the dish page — opened by Finish (`?share=1`) or the dish
 * page's Share. What Finish did; the dish's name and recipe line, the photo
 * slot (CM-4 turns it on), the caption; WHAT IT SHOWS; "Never shown: …";
 * WHO SEES IT; Not now · Post. Post is instant, with Undo (it deletes the
 * post); a dish shared already opens its post.
 */

function readShared(): Record<string, string> {
  try {
    return parseSharedPosts(window.localStorage.getItem(SHARED_POSTS_KEY));
  } catch {
    return {};
  }
}

function rememberShared(dishId: string, postId: string | null): void {
  try {
    window.localStorage.setItem(SHARED_POSTS_KEY, JSON.stringify(withSharedPost(readShared(), dishId, postId)));
  } catch {
    // Private mode: Share keeps reading Share, and the server answers already_posted.
  }
}

/** The post this browser remembers a dish became, or null. */
export function useSharedPost(dishId: string): [string | null, (postId: string | null) => void] {
  const [postId, setPostId] = React.useState<string | null>(null);
  React.useEffect(() => setPostId(readShared()[dishId] ?? null), [dishId]);
  const set = React.useCallback(
    (id: string | null) => {
      rememberShared(dishId, id);
      setPostId(id);
    },
    [dishId],
  );
  return [postId, set];
}

function readStepSeed(dishId: string) {
  try {
    return parseStepSeed(window.sessionStorage.getItem(stepSeedKey(dishId)));
  } catch {
    return parseStepSeed(null);
  }
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ShareCookSheet({
  dish,
  groupName,
  open,
  onClose,
  onPosted,
}: {
  dish: KitchenDish;
  groupName: string | null;
  open: boolean;
  onClose: () => void;
  /** The post it became (or was already). */
  onPosted: (postId: string) => void;
}) {
  const mine = useMyCommunityProfile({ enabled: open });
  const profile = mine.data?.profile ?? null;
  const me = usePersonProfile(open ? (profile?.handle ?? null) : null);
  const recipe = useRecipe(open ? (dish.recipeId ?? null) : null);
  const createPost = useCreatePost();
  const router = useKitchenRouter();
  const { toast } = useToast();
  const [steps] = React.useState(() => (typeof window === "undefined" ? parseStepSeed(null) : readStepSeed(dish.id)));

  const r = recipe.data?.recipe ?? null;
  const main = r && dish.recipeFactorMilli ? mainLineOf(r) : null;
  const preview = previewOf(dish, {
    main: main && dish.recipeFactorMilli ? { qtyMilli: mainAmountMilli(main, dish.recipeFactorMilli), unit: main.unit } : null,
    ownRecipe: !!r && r.mine && !r.source,
    steps,
  });
  const followers = me.data?.counts.followers ?? null;
  const audiences = audienceOptions(profile, followers);
  const ready = !mine.loading;
  const [draft, setDraft] = React.useState<ShareDraft | null>(null);
  React.useEffect(() => {
    if (open && ready && draft === null) setDraft(shareDefaults(preview, !!profile));
  }, [open, ready, draft, preview, profile]);
  const d = draft ?? shareDefaults(preview, !!profile);
  const set = (change: Partial<ShareDraft>) => setDraft({ ...d, ...change });

  const post = () => {
    const body = createPostRequest(dish.id, d);
    onClose();
    void createPost({
      body,
      toast: postedToast(d.audience, followers, profile?.privacy === "private"),
      myHandle: profile?.handle ?? null,
      refusedText: postRefusal,
    }).then((out) => {
      if (out.kind === "posted") onPosted(out.post.id);
      else if (out.kind === "open") {
        onPosted(out.postId);
        router.push(postHref(out.postId));
      }
    });
  };
  const notNow = () => {
    onClose();
    toast({ kind: "success", ...NOT_NOW_TOAST });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        // No keyboard on open: the caption is optional.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn("mx-auto flex h-[94dvh] max-w-xl flex-col gap-3 rounded-t-[28px] border-x-0 bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 min-[900px]:bottom-6 min-[900px]:h-[86dvh] min-[900px]:rounded-[28px] min-[900px]:border", CLOSE_44)}>
        <div aria-hidden className="mx-auto h-[5px] w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <div className="-mx-5 min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 pb-2">
          <span className="inline-flex rounded-full bg-cp-herb-tint px-2.5 py-1 text-xs font-medium text-cp-accent-text">{shareTopLine(dish, groupName)}</span>
          <SheetTitle className="pr-12 text-[26px] font-medium tracking-[-0.02em]">{SHARE_TITLE}</SheetTitle>

          <div className="flex flex-col gap-3 rounded-cp-card bg-card shadow-cp-card p-3.5">
            {/* CM-4: the photo slot turns on with uploads. */}
            <button type="button" disabled aria-disabled className="flex h-[120px] flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed border-border bg-background text-muted-foreground">
              <Camera className="h-6 w-6" strokeWidth={2} aria-hidden />
              <span className="text-[15px] font-medium">{PHOTO_SOON}</span>
              <span className="text-xs font-normal">The recipe tile shows without one</span>
            </button>
            <div className="flex flex-col">
              <span className="break-words text-xl font-medium">{dish.name}</span>
              <span className="text-[13px] font-normal text-muted-foreground">{composerRecipeLine(preview)}</span>
            </div>
            <label className="flex flex-col gap-1.5">
              <SectionLabel>Say something</SectionLabel>
              <textarea
                rows={3}
                value={d.caption}
                maxLength={POST_CAPTION_MAX}
                placeholder={CAPTION_PLACEHOLDER}
                onChange={(e) => set({ caption: e.target.value })}
                className={cn("resize-none rounded-[14px] border border-input bg-card px-3 py-2.5 text-[15px] font-normal outline-none", FOCUS)}
              />
            </label>
          </div>

          <section aria-labelledby="show-h" className="flex flex-col gap-2">
            <SectionLabel id="show-h">What it shows</SectionLabel>
            <div className="divide-y divide-cp-line overflow-hidden rounded-cp-card bg-card shadow-cp-card">
              {showRows(preview).map((row) => {
                const on = d.show[row.id];
                return (
                  <button
                    key={row.id}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => set({ show: { ...d.show, [row.id]: !on } })}
                    className={cn("flex min-h-[52px] w-full items-center gap-3 px-3.5 text-left", FOCUS)}
                  >
                    <span className="flex-1 text-[15px] font-medium">{row.label}</span>
                    <span className="text-[13px] font-normal text-muted-foreground tabular-nums">{row.value ?? "if timed"}</span>
                    <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-input")}>
                      <span className={cn("absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-cp-card transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="px-0.5 text-[13px] font-normal text-muted-foreground">{NEVER_SHOWN}</p>
          </section>

          <section aria-labelledby="who-h" className="flex flex-col gap-2">
            <SectionLabel id="who-h">Who sees it</SectionLabel>
            {!ready ? (
              <Skeleton className="h-[60px] w-full rounded-2xl" />
            ) : (
              <div role="radiogroup" aria-labelledby="who-h" className={cn("grid gap-1.5", audiences.options.length === 3 ? "grid-cols-3" : "grid-cols-1")}>
                {audiences.options.map((a) => (
                  <AudienceButton key={a.id} label={a.label} sub={a.sub} on={d.audience === a.id} onPick={() => set({ audience: a.id as PostAudience })} />
                ))}
              </div>
            )}
            {audiences.needsHandle && ready ? (
              <Link href={HANDLE_SETUP_HREF} className="flex min-h-11 items-center px-0.5 text-[15px] font-medium text-primary hover:underline">
                {PICK_HANDLE_TO_SHARE}
              </Link>
            ) : null}
          </section>
        </div>
        <div className="grid shrink-0 grid-cols-[1fr_2fr] gap-2">
          <Button type="button" variant="ghost" onClick={notNow} className={cn(K_BUTTON_QUIET, "min-h-[60px] rounded-[18px] text-base")}>
            Not now
          </Button>
          <Button type="button" disabled={!ready} onClick={post} className={cn(K_BUTTON, "min-h-[60px] rounded-[18px] text-[17px] font-medium")}>
            {postButtonLabel(d.audience)}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AudienceButton({ label, sub, on, onPick }: { label: string; sub: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "flex min-h-[60px] flex-col items-center justify-center rounded-2xl px-1.5 py-1.5 text-center transition-colors",
        FOCUS,
        on ? "bg-cp-accent-tint ring-[1.5px] ring-inset ring-primary" : "bg-card shadow-cp-card hover:bg-accent",
      )}
    >
      <span className="text-[15px] font-medium">{label}</span>
      <span className="text-[11px] font-medium leading-tight text-muted-foreground">{sub}</span>
    </button>
  );
}

/** The dish page's Share (yours, postable): opens the sheet, or "See your post" once this browser knows it. */
export function DishShareButton({ postId, onShare }: { postId: string | null; onShare: () => void }) {
  const cls = cn("flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-cp-accent-tint text-[15px] font-medium text-cp-accent-text hover:bg-cp-accent-tint/80", FOCUS);
  if (postId) {
    return (
      <Link href={postHref(postId)} className={cls}>
        <Share2 className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
        See your post
      </Link>
    );
  }
  return (
    <button type="button" onClick={onShare} className={cls}>
      <Share2 className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
      Share this cook
    </button>
  );
}

/** Finish leaves the session's step times for the dish page's Share (this tab only): the dish read doesn't carry them. */
export function rememberStepSeed(dishId: string, guide: CookGuide | null | undefined): void {
  const seed = stepSeedOf(guide);
  if (seed.minutes === null) return;
  try {
    window.sessionStorage.setItem(stepSeedKey(dishId), JSON.stringify(seed));
  } catch {
    // Private mode: Time shows "if timed", and the server still computes it.
  }
}
