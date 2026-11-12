"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Mail, Plus } from "lucide-react";
import type { Passkey, PasskeysListResponse } from "@saas/contracts/passkeys";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";
import { lastSignInMethod } from "@/lib/first-run";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BackButton } from "./back-ui";
import { KCard, K_BUTTON, K_SECTION, K_TITLE } from "./kit";
import { useProfile } from "./data";
import { GoogleMark, NoticeBox } from "./sign-in-ui";
import { offersGoogle } from "./sign-in";
import {
  PASSKEY_REMOVED,
  PASSKEY_REMOVE_FAILED_NOTICE,
  canAddPasskey,
  holdRemoval,
  otherWaysIn,
  passkeyMeta,
  type HeldRemoval,
} from "./passkeys";
import {
  AddNoticeView,
  SECURITY_TITLE,
  addNotice,
  addPasskeyHere,
  usePasskeysHere,
  useRegisterOptions,
  type AddNotice,
} from "./passkey-ui";

/**
 * You → Sign-in and security (Cookpool PK-4, `PasskeyManage`), in every
 * frame: your passkeys by device name and last use, each with Remove (held
 * 5 s for Undo, then the DELETE); Add a passkey on this device; and the other
 * ways in, Google and the email code (always on). Add's register options are
 * fetched when the button shows (PK-6: iPhone Safari opens the sheet only
 * from the tap), and a failure stays on screen with Try again and the
 * browser's or the server's reason under it. Where passkeys do not run
 * the passkey part is not shown (You has no row here then; an address typed
 * in shows only the other ways in). No "Sign out everywhere" (out of scope).
 */

const LABEL = K_SECTION;

interface Pending {
  passkey: Passkey;
  held: HeldRemoval;
}

export function SecurityScreen() {
  const { runs } = usePasskeysHere();
  const profile = useProfile();
  const email = profile.data?.email ?? "";
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <header className="flex items-center gap-2">
        <BackButton />
        <h1 className={K_TITLE}>{SECURITY_TITLE}</h1>
      </header>
      {runs === null ? <Skeleton aria-hidden className="h-32 w-full rounded-[18px]" /> : runs ? <PasskeysSection /> : null}
      <OtherWays email={email} loading={profile.loading} />
    </div>
  );
}

function PasskeysSection() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { device } = usePasskeysHere();
  const list = useApiQuery(qk.passkeys(), () => wrap(() => client.auth.passkeys()));
  const [now] = React.useState(() => Date.now());
  const [pending, setPending] = React.useState<Pending | null>(null);
  const pendingRef = React.useRef<Pending | null>(null);
  pendingRef.current = pending;
  const [adding, setAdding] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [addResult, setAddResult] = React.useState<AddNotice | null>(null);

  // Leaving the page sends a held removal at once rather than dropping it.
  React.useEffect(() => () => pendingRef.current?.held.flush(), []);

  const all = list.data?.passkeys ?? [];
  const shown = pending ? all.filter((p) => p.id !== pending.passkey.id) : all;
  const addShown = Boolean(list.data) && canAddPasskey(shown.length);
  const registerOptions = useRegisterOptions(client, addShown);

  const remove = (passkey: Passkey) => {
    setNotice(null);
    // One removal at a time: an earlier one is sent now.
    pendingRef.current?.held.flush();
    const held = holdRemoval(
      () => {
        // Undo's time is up: the row leaves the list now, and the DELETE goes.
        qc.setQueryData<PasskeysListResponse>(qk.passkeys(), (old) =>
          old ? { ...old, passkeys: old.passkeys.filter((p) => p.id !== passkey.id) } : old,
        );
        setPending((cur) => (cur?.passkey.id === passkey.id ? null : cur));
        void wrap(() => client.auth.removePasskey(passkey.id)).then((r) => {
          // 404: already gone. Anything else: it still works, so it comes back.
          if (r.ok || r.status === 404) return;
          setNotice(PASSKEY_REMOVE_FAILED_NOTICE);
          void qc.invalidateQueries({ queryKey: qk.passkeys() });
        });
      },
      { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
    );
    setPending({ passkey, held });
  };

  const undo = () => {
    if (pending?.held.undo()) setPending(null);
  };

  // Straight from the tap: no await before the sheet opens.
  const add = () => {
    if (adding) return;
    setNotice(null);
    setAdding(true);
    void addPasskeyHere(client, device, registerOptions).then((out) => {
      setAdding(false);
      // A closed sheet clears the notice and says nothing.
      setAddResult(addNotice(out, device));
      if (out.kind === "added") {
        qc.setQueryData<PasskeysListResponse>(qk.passkeys(), (old) => ({
          passkeys: [out.passkey, ...(old?.passkeys ?? []).filter((p) => p.id !== out.passkey.id)],
        }));
      }
    });
  };

  return (
    <section aria-labelledby="security-passkeys" className="flex flex-col gap-2">
      <h2 id="security-passkeys" className={LABEL}>
        Passkeys
      </h2>
      {list.loading ? (
        <Skeleton aria-hidden className="h-16 w-full rounded-[18px]" />
      ) : list.error && !list.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your passkeys.</p>
          <Button variant="outline" className={K_BUTTON} onClick={list.reload}>
            Try again
          </Button>
        </KCard>
      ) : shown.length === 0 ? (
        <KCard className="rounded-[18px] px-3.5 py-4 text-sm text-muted-foreground">
          No passkeys yet. Add one to sign in with Face ID or your fingerprint.
        </KCard>
      ) : (
        <ul className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
          {shown.map((p, i) => (
            <li
              key={p.id}
              className={cn("flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-2", i < shown.length - 1 && "border-b border-cp-line")}
            >
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cp-accent-tint text-cp-accent-text">
                <KeyRound className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-base font-medium">{p.deviceName}</span>
                <span className="text-[13px] text-muted-foreground">{passkeyMeta(p, now)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(p)}
                aria-label={`Remove passkey ${p.deviceName}`}
                className="min-h-11 rounded-xl px-3 text-sm font-medium text-destructive hover:bg-cp-expired-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {addShown ? (
        <Button
          type="button"
          variant="outline"
          loading={adding}
          onClick={add}
          className="h-[52px] gap-2 rounded-2xl border-0 bg-cp-accent-tint text-[15px] font-medium text-cp-accent-text shadow-none hover:bg-cp-accent-tint/80"
        >
          {adding ? null : <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />}
          {addResult?.retry ? "Try again" : "Add a passkey on this device"}
        </Button>
      ) : null}
      {addResult ? <AddNoticeView notice={addResult} /> : null}
      {notice ? <NoticeBox notice={{ tone: "error", text: notice }} /> : null}
      {pending ? (
        <div role="status" className="flex items-center gap-2.5 rounded-[14px] bg-foreground py-1.5 pl-3.5 pr-1.5 text-sm font-medium text-background">
          <span className="flex-1">{PASSKEY_REMOVED}</span>
          <button
            type="button"
            onClick={undo}
            className="min-h-11 rounded-[10px] bg-background px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}

function OtherWays({ email, loading }: { email: string; loading: boolean }) {
  const { client } = useSession();
  const [googleOffered, setGoogleOffered] = React.useState(false);
  const [googleLinked, setGoogleLinked] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setGoogleLinked(lastSignInMethod() === "google");
    void wrap(() => client.auth.listOAuthProviders()).then((r) => {
      if (!cancelled && r.ok) setGoogleOffered(offersGoogle(r.data.providers));
    });
    return () => {
      cancelled = true;
    };
    // Once per visit: the providers do not change while the page is open.
  }, []);
  const rows = otherWaysIn({ email, googleOffered, googleLinked });
  return (
    <section aria-labelledby="security-other" className="flex flex-col gap-2">
      <h2 id="security-other" className={LABEL}>
        Other ways in
      </h2>
      {loading ? (
        <Skeleton aria-hidden className="h-[60px] w-full rounded-[18px]" />
      ) : (
        <ul className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
          {rows.map((row, i) => (
            <li
              key={row.way}
              className={cn("flex min-h-[60px] items-center gap-3 px-3.5 py-2.5", i < rows.length - 1 && "border-b border-cp-line")}
            >
              {row.way === "google" ? (
                <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border-[1.5px] border-border">
                  <GoogleMark className="h-4 w-4" />
                </span>
              ) : (
                <Mail className="h-[30px] w-[30px] shrink-0 text-foreground" strokeWidth={1.6} aria-hidden />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-base font-medium">{row.title}</span>
                <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{row.subtitle}</span>
              </span>
              {row.badge ? <span className="shrink-0 text-[13px] font-medium text-cp-accent-text">{row.badge}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
