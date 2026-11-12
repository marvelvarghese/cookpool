"use client";

import * as React from "react";
import { POST_AUDIENCES, type CommunityPost, type PostAudience, type ReportReason, type ReportTargetKind } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { atHandle, profileFirstName, profileMenuText } from "./community";
import { PrivacyRow, SectionLabel } from "./community-views";
import { REPORT_NOTE_MAX, REPORT_REASON_ROWS, reportTitle } from "./community-activity";
import { AUDIENCE_WORDS, postMenuItems } from "./community-posts";
import { useDeletePost, useEditAudience, usePostAuthorActions, useReport } from "./community-posts-data";

/**
 * Report, and a post's ⋯ (cookpool-community CM-6): the report sheet — a
 * reason (spam, abuse, unsafe, something else) and a note — for a post, a
 * comment or a profile; the ⋯ on someone else's post (Report · Mute · Block)
 * and on yours (Who sees it · Delete, with Undo).
 */

const SHEET = cn(
  "mx-auto flex max-h-[92dvh] max-w-xl flex-col gap-2 rounded-t-[24px] border-x-0 bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
  CLOSE_44,
);
const ITEM = "min-h-[52px] w-full rounded-[14px] px-4 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PLAIN = "border border-border bg-card hover:bg-accent";
const RED = "bg-cp-expired-tint text-destructive hover:bg-cp-expired-tint/80";

function Grip() {
  return <div aria-hidden className="mx-auto mb-1 h-[5px] w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />;
}

export interface ReportTarget {
  kind: ReportTargetKind;
  id: string;
  /** A profile's handle, for the title. */
  handle?: string | null;
}

/** The report sheet: why (one of four), an optional note, Report. Nothing to undo: it is only stored. */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const report = useReport();
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setReason(null);
    setNote("");
  }, [target?.id]);
  const send = async () => {
    if (!target || !reason || busy) return;
    setBusy(true);
    const ok = await report(target, reason, note);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={SHEET}>
        <Grip />
        <SheetTitle className="flex min-h-11 items-center pr-12 text-lg font-medium">{target ? reportTitle(target.kind, target.handle) : "Report"}</SheetTitle>
        <div className="-mx-5 min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-1">
          <div role="radiogroup" aria-label="Why" className="flex flex-col gap-2">
            {REPORT_REASON_ROWS.map((r) => (
              <PrivacyRow key={r.id} title={r.title} sub={r.sub} on={reason === r.id} onPick={() => setReason(r.id)} />
            ))}
          </div>
          <label className="flex flex-col gap-1.5 pt-1">
            <SectionLabel>Note · optional</SectionLabel>
            <textarea
              value={note}
              rows={2}
              maxLength={REPORT_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What's wrong with it?"
              className="resize-none rounded-[14px] border border-border bg-card px-3 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="text-[13px] font-medium text-muted-foreground">They aren&apos;t told who reported it.</p>
        </div>
        <Button type="button" disabled={!reason} loading={busy} onClick={() => void send()} className="min-h-[52px] shrink-0 rounded-[16px] text-base font-medium">
          Report
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A post's ⋯. Someone else's: Report, Mute (their posts leave Following),
 * Block (they're gone from everything, untold). Yours: Who sees it (the three
 * audiences, with Undo) and Delete (Undo restores it for 10 minutes).
 */
export function PostMenuSheet({
  post,
  onClose,
  onReport,
  onGone,
}: {
  post: CommunityPost | null;
  onClose: () => void;
  onReport: (target: ReportTarget) => void;
  /** Your post deleted, or its author blocked: the post's page goes back. */
  onGone?: () => void;
}) {
  const del = useDeletePost();
  const audience = useEditAudience();
  const author = usePostAuthorActions();
  const items = post ? postMenuItems(post) : [];
  const words = post?.author ? profileMenuText(post.author, false) : null;
  const pick = (to: PostAudience) => {
    if (!post) return;
    onClose();
    audience(post, to);
  };
  return (
    <Sheet open={post !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={SHEET}>
        <Grip />
        <SheetTitle className="flex min-h-11 items-center pr-12 text-lg font-medium">{post?.title ?? ""}</SheetTitle>
        {post ? (
          <div className="flex flex-col gap-2">
            {items.includes("audience") ? (
              <section aria-labelledby="who-sees" className="flex flex-col gap-1.5">
                <SectionLabel id="who-sees">Who sees it</SectionLabel>
                <div role="radiogroup" aria-labelledby="who-sees" className="grid grid-cols-3 gap-1.5">
                  {POST_AUDIENCES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={post.audience === a}
                      onClick={() => pick(a)}
                      className={cn(
                        "min-h-[52px] rounded-2xl text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        post.audience === a ? "border-[1.5px] border-primary bg-cp-herb-tint" : "border border-border bg-card hover:bg-accent",
                      )}
                    >
                      {AUDIENCE_WORDS[a]}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {items.includes("delete") ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  del(post, onGone);
                }}
                className={cn(ITEM, RED, "mt-1")}
              >
                Delete post
              </button>
            ) : null}
            {items.includes("report") ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReport({ kind: "post", id: post.id });
                }}
                className={cn(ITEM, PLAIN)}
              >
                Report this post
              </button>
            ) : null}
            {items.includes("mute") && post.author ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  author.mute(post.author!);
                }}
                className={cn(ITEM, PLAIN)}
              >
                Mute {profileFirstName(post.author)}&apos;s posts
              </button>
            ) : null}
            {items.includes("block") && post.author && words ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    author.block(post.author!, (stands) => stands && onGone?.());
                  }}
                  className={cn(ITEM, RED)}
                >
                  Block {atHandle(post.author.handle)}
                </button>
                <p className="text-center text-[13px] font-medium text-muted-foreground">{words.blockNote}</p>
              </>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
