"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Link2Off, UsersRound } from "lucide-react";
import type { JoinPreview } from "@saas/contracts/membership";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { recordRecentGroup } from "@/lib/recent-groups";
import { clearJoinAfterSignIn, joinAfterSignInPending } from "@/lib/login-return";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { extractJoinCode, joinFailureKind, type JoinFailure } from "@/components/kitchen/join-code";
import { GroupAvatar, IconBubble, KCard, K_BUTTON } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { useKitchenRouter } from "@/components/kitchen/transition-ui";

/**
 * Join from a link (CP-5): `/join/<code>`. Signing in is required — the
 * kitchen layout sends a signed-out person to sign-in and back here. The page
 * previews the group (name, member count), then joins in one tap. Back
 * (PW-3) goes to Groups when the link opened the app.
 *
 * Arriving from sign-in (SI-5), where the person already saw the group's card
 * and signed in to join it, there is no second tap: the page joins at once and
 * opens the group. Sign-in records that in this tab (`login-return.ts`), for
 * this code only — a link cannot ask for it, so nobody is joined to a group
 * they did not see.
 */
export default function JoinPage() {
  const code = extractJoinCode(safeDecode(usePathParam("/join/:code", "code")));
  return (
    <>
      <header className="flex min-h-11 items-center">
        <BackButton />
      </header>
      <div className="mx-auto w-full max-w-md pt-2 min-[900px]:pt-8">
        {code ? <JoinFlow code={code} /> : <LinkNotFound />}
      </div>
    </>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type Outcome =
  | { kind: "joined"; slug: string; alreadyMember: boolean }
  | { kind: "failed"; failure: JoinFailure };

function JoinFlow({ code }: { code: string }) {
  const { client } = useSession();
  const router = useKitchenRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const preview = useApiQuery(qk.joinPreview(code), () => wrap(() => client.memberships.previewJoin(code)));
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  // Sent here by sign-in to join this group (SI-5)? Read once, then cleared.
  const [fromSignIn] = React.useState(() => joinAfterSignInPending(code));
  // "Joining…" until the automatic join lands (and the group opens) or fails.
  const [autoJoining, setAutoJoining] = React.useState(fromSignIn);
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (fromSignIn) clearJoinAfterSignIn();
  }, [fromSignIn]);

  /** Join; true when the group was joined (or already was). */
  const join = async (group: JoinPreview, openAfter = false): Promise<boolean> => {
    setBusy(true);
    // A fresh key per attempt: /v1/join is not under an org path, so a key
    // derived from the code could replay someone else's join (sdk docs).
    const r = await wrap(() => client.memberships.join(code, { idempotencyKey: crypto.randomUUID() }));
    if (!r.ok) {
      setBusy(false);
      const failure = joinFailureKind(r.error, r.status);
      if (failure === "error") {
        toast({ kind: "error", title: "Couldn't join", description: r.error.message });
        return false;
      }
      setOutcome({ kind: "failed", failure });
      return false;
    }
    recordRecentGroup(r.data.slug);
    // Have the new group in the list before offering to open it.
    await qc.invalidateQueries({ queryKey: qk.orgs() });
    void qc.invalidateQueries({ queryKey: qk.joinPreview(code) });
    if (!r.data.alreadyMember) toast({ kind: "success", title: `You joined ${group.name}` });
    if (openAfter) {
      // From sign-in: straight into the group, joined.
      router.replace(`/groups/${encodeURIComponent(r.data.slug)}`);
      return true;
    }
    setBusy(false);
    setOutcome({ kind: "joined", slug: r.data.slug, alreadyMember: r.data.alreadyMember });
    return true;
  };

  React.useEffect(() => {
    if (!fromSignIn || autoStarted.current || !preview.data) return;
    autoStarted.current = true;
    if (preview.data.alreadyMember) {
      router.replace(`/groups/${encodeURIComponent(preview.data.slug)}`);
      return;
    }
    // Runs once (`autoStarted`); `join` reads this render's client and cache.
    void join(preview.data, true).then((joined) => {
      if (!joined) setAutoJoining(false);
    });
  }, [fromSignIn, preview.data, router]);

  if (preview.loading) {
    return (
      <KCard className="p-6" aria-hidden>
        <Skeleton className="h-14 w-14 rounded-[16px]" />
        <Skeleton className="mt-5 h-4 w-32" />
        <Skeleton className="mt-2 h-8 w-56" />
        <Skeleton className="mt-6 h-12 w-full rounded-xl" />
      </KCard>
    );
  }

  if (preview.error) {
    if (preview.error.code === "not_found") return <LinkNotFound />;
    return (
      <KCard className="p-6">
        <h1 className="text-lg font-bold">Couldn&apos;t open this link</h1>
        <p className="mt-1 text-sm text-muted-foreground">{preview.error.message}</p>
        <Button variant="outline" className={cn(K_BUTTON, "mt-4")} onClick={preview.reload}>
          Try again
        </Button>
      </KCard>
    );
  }

  const group = preview.data!;
  const openHref = `/groups/${outcome?.kind === "joined" ? outcome.slug : group.slug}`;

  if (autoJoining && !outcome) {
    return (
      <KCard className="p-6" role="status">
        <GroupAvatar name={group.name} size="lg" />
        <p className="mt-5 text-sm font-semibold text-primary">You&apos;re signed in</p>
        <h1 className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight">Joining {group.name}…</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your own kitchen comes with you.</p>
      </KCard>
    );
  }

  if (outcome?.kind === "failed" && outcome.failure === "not_found") return <LinkNotFound />;

  if (outcome?.kind === "joined" && !outcome.alreadyMember) {
    return (
      <KCard className="p-6 text-center">
        <IconBubble icon={CircleCheck} className="mx-auto h-16 w-16 [&_svg]:h-8 [&_svg]:w-8" />
        <h1 className="mt-5 text-[26px] font-extrabold leading-tight tracking-tight">You&apos;re in.</h1>
        <p className="mt-1 text-base text-muted-foreground">Your own kitchen comes with you.</p>
        <Button asChild className={cn(K_BUTTON, "mt-6 h-12 w-full")}>
          <Link href={openHref}>Open {group.name}</Link>
        </Button>
      </KCard>
    );
  }

  if (group.alreadyMember || (outcome?.kind === "joined" && outcome.alreadyMember)) {
    return (
      <KCard className="p-6 text-center">
        <GroupAvatar name={group.name} size="lg" className="mx-auto" />
        <h1 className="mt-5 text-2xl font-extrabold leading-tight tracking-tight">
          You&apos;re already in {group.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Nothing to do here — it&apos;s in your groups.</p>
        <Button asChild className={cn(K_BUTTON, "mt-6 h-12 w-full")}>
          <Link href={openHref}>Open {group.name}</Link>
        </Button>
      </KCard>
    );
  }

  const failure = outcome?.kind === "failed" ? outcome.failure : null;

  return (
    <KCard className="p-6">
      <GroupAvatar name={group.name} size="lg" />
      <p className="mt-5 text-sm font-semibold text-primary">You&apos;re invited to join</p>
      <h1 className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight">{group.name}</h1>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <UsersRound className="h-4 w-4" aria-hidden />
        <span>
          <span className="tabular-nums">{group.memberCount}</span>{" "}
          {group.memberCount === 1 ? "member" : "members"}
        </span>
      </p>

      {failure === "full" ? (
        <div role="alert" className="mt-5 rounded-xl bg-cp-soon-tint p-3 text-sm text-cp-soon">
          <p className="font-bold">This group is full</p>
          <p className="mt-0.5">It has as many members as it can have. Ask someone in it to make room.</p>
        </div>
      ) : failure === "too_many_groups" ? (
        <div role="alert" className="mt-5 rounded-xl bg-cp-soon-tint p-3 text-sm text-cp-soon">
          <p className="font-bold">You&apos;re in as many groups as you can be</p>
          <p className="mt-0.5">Leave a group you no longer use, then open this link again.</p>
        </div>
      ) : null}

      <Button
        className={cn(K_BUTTON, "mt-6 h-12 w-full text-base")}
        loading={busy}
        disabled={failure === "full" || failure === "too_many_groups"}
        onClick={() => void join(group)}
      >
        Join {group.name}
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        You&apos;ll join as a member, and you can leave any time.
      </p>
    </KCard>
  );
}

function LinkNotFound() {
  return (
    <KCard className="p-6 text-center">
      <IconBubble icon={Link2Off} tone="neutral" className="mx-auto h-14 w-14" />
      <h1 className="mt-5 text-2xl font-extrabold leading-tight tracking-tight">This link doesn&apos;t work</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        It may have been mistyped, or the group made a new link. Ask someone in the group for the latest one.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button asChild className={cn(K_BUTTON, "w-full")}>
          <Link href="/groups?join=1">Enter a code</Link>
        </Button>
        <Button asChild variant="ghost" className={cn(K_BUTTON, "w-full")}>
          <Link href="/groups">Your groups</Link>
        </Button>
      </div>
    </KCard>
  );
}
