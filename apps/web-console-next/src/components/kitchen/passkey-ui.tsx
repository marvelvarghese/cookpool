"use client";

import * as React from "react";
import { Check, ChevronRight, KeyRound, ScanFace, ShieldCheck } from "lucide-react";
import Link from "./link";
import { cn } from "@/lib/cn";
import { wrap, type ApiClient, type ApiResult } from "@/lib/api";
import type { PasskeyCreationOptionsJSON } from "@saas/contracts/passkeys";
import {
  dismissOffer,
  markDeviceHasPasskey,
  passkeysRunOnThisPage,
  register,
  thisDevice,
} from "@/lib/passkey-device";
import { NoticeBox } from "./sign-in-ui";
import {
  PASSKEY_ADD_FAILED_NOTICE,
  PASSKEY_BUTTON,
  PASSKEY_LIMIT_NOTICE,
  PASSKEY_TAP_AGAIN_NOTICE,
  addPasskey,
  createOptionsPrefetch,
  offerCopy,
  passkeyAlreadyNotice,
  passkeyDeviceName,
  type AddPasskeyOutcome,
  type OptionsPrefetch,
  type PasskeyDevice,
} from "./passkeys";

/**
 * The passkey pieces (Cookpool PK-4), after the canvas row "Getting in":
 * Sign in with a passkey (`AuthWelcome`, `WebAuth`), the one-time Turn on
 * Face ID (`PasskeyOffer`) and You's row to Sign-in and security
 * (`PasskeyManage`, in `passkey-security-ui.tsx`). Inside the `.cookpool`
 * theme only.
 */

export const SECURITY_PATH = "/you/security";
export const SECURITY_TITLE = "Sign-in and security";

/**
 * Whether passkeys run on this page, decided after mount (the pages are
 * prerendered files): null until then, so nothing passkey-shaped flashes
 * where they do not run.
 */
export function usePasskeysHere(): { runs: boolean | null; device: PasskeyDevice } {
  const [state, setState] = React.useState<{ runs: boolean | null; device: PasskeyDevice }>({ runs: null, device: "other" });
  React.useEffect(() => {
    setState({ runs: passkeysRunOnThisPage(), device: thisDevice() });
  }, []);
  return state;
}

/**
 * Ceremony options fetched before the tap (PK-6; iPhone Safari opens the
 * sheet only from the tap itself). While `enabled`, it fetches when shown,
 * again when the held options go stale (4 minutes; the challenge lives 5) or
 * the tab comes back, and the ceremonies refill it after each attempt.
 */
export function usePrefetchedOptions<T>(fetchOptions: () => Promise<ApiResult<{ options: T }>>, enabled: boolean): OptionsPrefetch<T> {
  const fetchRef = React.useRef(fetchOptions);
  fetchRef.current = fetchOptions;
  const [prefetch] = React.useState(() => createOptionsPrefetch<T>(() => fetchRef.current()));
  React.useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    const keepFresh = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void prefetch.refresh().then(() => {
        if (stopped) return;
        window.clearTimeout(timer);
        // A failure is not retried on a timer: the tap fetches again.
        const at = prefetch.staleAt();
        if (at !== null) timer = window.setTimeout(keepFresh, Math.max(1000, at - Date.now()));
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") keepFresh();
    };
    keepFresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, prefetch]);
  return prefetch;
}

/** Register options for this session, fetched ahead (`usePrefetchedOptions`). */
export function useRegisterOptions(client: ApiClient, enabled: boolean): OptionsPrefetch<PasskeyCreationOptionsJSON> {
  return usePrefetchedOptions(() => wrap(() => client.auth.passkeyRegisterOptions()), enabled);
}

/**
 * The ceremony that adds a passkey on this device, through the session's
 * client. Call it straight from the tap: the sheet opens before it returns.
 */
export function addPasskeyHere(
  client: ApiClient,
  device: PasskeyDevice,
  options: OptionsPrefetch<PasskeyCreationOptionsJSON>,
): Promise<AddPasskeyOutcome> {
  return addPasskey({
    options,
    register,
    registerVerify: (input) => wrap(() => client.auth.passkeyRegisterVerify(input)),
    deviceName: passkeyDeviceName(device),
  }).then((out) => {
    // Added here, or this device already holds one: either way the offer never shows here again.
    if (out.kind === "added" || out.kind === "already") markDeviceHasPasskey();
    return out;
  });
}

/** What an add that did not save shows: the notice, and the browser's error name or the server's step under it. */
export interface AddNotice {
  text: string;
  detail: string | null;
  tone: "error" | "info";
  /** The button reads Try again. */
  retry: boolean;
}

/** The notice for an outcome that stays on the screen; null for added and cancelled. */
export function addNotice(out: AddPasskeyOutcome, device: PasskeyDevice): AddNotice | null {
  if (out.kind === "failed") return { text: PASSKEY_ADD_FAILED_NOTICE, detail: out.detail, tone: "error", retry: true };
  if (out.kind === "limit") return { text: PASSKEY_LIMIT_NOTICE, detail: null, tone: "error", retry: false };
  if (out.kind === "already") return { text: passkeyAlreadyNotice(device), detail: null, tone: "info", retry: false };
  if (out.kind === "retry") return { text: PASSKEY_TAP_AGAIN_NOTICE, detail: null, tone: "info", retry: true };
  return null;
}

/** A notice, with the small muted detail under it for the owner to read out. */
export function AddNoticeView({ notice }: { notice: AddNotice }) {
  return (
    <div className="flex flex-col gap-1">
      <NoticeBox notice={{ tone: notice.tone, text: notice.text }} />
      {notice.detail ? (
        <p data-passkey-detail className="px-1 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {notice.detail}
        </p>
      ) : null}
    </div>
  );
}

const SPINNER = <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;

/** "Sign in with a passkey": dark, above Google (`AuthWelcome`, `WebAuth`). */
export function PasskeySignInButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[#17201B] px-5 text-base font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70"
    >
      {busy ? SPINNER : <KeyRound className="h-[22px] w-[22px]" strokeWidth={1.8} aria-hidden />}
      {PASSKEY_BUTTON}
    </button>
  );
}

type OfferStep = "ask" | "busy" | "done" | "already" | "limit";

/**
 * Turn on Face ID (`PasskeyOffer`): a full-screen step after a code or
 * Google sign-in, before landing. Turn on saves a passkey here, then says so
 * and Go on; Not now waits 30 days. It never moves on by itself after a
 * failure (PK-6): a closed sheet leaves the offer as it was; a failure says
 * so, with the browser's error or the server's step under it, and offers Try
 * again and Not now; the 10-passkey limit says where to remove one; a device
 * that already holds one counts as on. The register options are fetched when
 * the offer shows, so the tap opens the sheet at once.
 */
export function PasskeyOfferScreen({
  client,
  device,
  firstName,
  onFinish,
}: {
  client: ApiClient;
  device: PasskeyDevice;
  firstName: string | null;
  onFinish: () => void;
}) {
  const copy = offerCopy(device, firstName);
  const options = useRegisterOptions(client, true);
  const [step, setStep] = React.useState<OfferStep>("ask");
  const [notice, setNotice] = React.useState<AddNotice | null>(null);
  const goRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (step === "done" || step === "already" || step === "limit") goRef.current?.focus();
  }, [step]);

  // Straight from the tap: no await before the sheet opens.
  const turnOn = () => {
    if (step !== "ask") return;
    setStep("busy");
    void addPasskeyHere(client, device, options).then((out) => {
      setNotice(addNotice(out, device));
      if (out.kind === "added") setStep("done");
      else if (out.kind === "already") setStep("already");
      else if (out.kind === "limit") setStep("limit");
      else setStep("ask");
    });
  };

  const notNow = () => {
    dismissOffer();
    onFinish();
  };

  const finished = step === "done" || step === "already";
  const tried = notice?.retry === true && step === "ask";
  return (
    <section
      aria-labelledby="passkey-offer-title"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-[18px] px-6 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-[calc(env(safe-area-inset-top)+56px)]"
    >
      {finished ? (
        <>
          <span aria-hidden className="mt-6 grid h-28 w-28 place-items-center self-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-14 w-14" strokeWidth={2.2} />
          </span>
          <div role="status" className="flex flex-col gap-2 text-center">
            <h1 id="passkey-offer-title" className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em]">
              {copy.doneTitle}
            </h1>
            <p className="text-[15px] leading-normal text-[#3F4842]">{step === "already" ? passkeyAlreadyNotice(device) : copy.doneBody}</p>
          </div>
          <button
            ref={goRef}
            type="button"
            onClick={onFinish}
            className="mt-auto min-h-14 rounded-2xl bg-[#17201B] text-base font-extrabold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go on
          </button>
        </>
      ) : (
        <>
          <span aria-hidden className="mt-6 grid h-28 w-28 place-items-center self-center rounded-[34px] bg-[#E4F2EA] text-primary">
            {device === "iphone" || device === "ipad" ? (
              <ScanFace className="h-[60px] w-[60px]" strokeWidth={1.5} />
            ) : (
              <KeyRound className="h-[56px] w-[56px]" strokeWidth={1.5} />
            )}
          </span>
          <div className="flex flex-col gap-2 text-center">
            <span className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-primary">{copy.eyebrow}</span>
            <h1 id="passkey-offer-title" className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em]">
              {copy.title}
            </h1>
            <p className="text-[15px] leading-normal text-[#3F4842]">{copy.body}</p>
          </div>
          <ul className="flex flex-col gap-2.5 rounded-[18px] border bg-card p-3.5">
            {copy.points.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm leading-[1.45] text-[#3F4842]">
                <Check className="mt-px h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={2.2} aria-hidden />
                {p}
              </li>
            ))}
          </ul>
          {notice ? <AddNoticeView notice={notice} /> : null}
          <div className="mt-auto flex flex-col gap-2">
            {step === "limit" ? (
              <button
                ref={goRef}
                type="button"
                onClick={notNow}
                className="min-h-14 rounded-2xl bg-[#17201B] text-base font-extrabold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Go on
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={turnOn}
                  disabled={step === "busy"}
                  aria-busy={step === "busy" || undefined}
                  className="flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-primary text-base font-extrabold text-primary-foreground hover:bg-[#165C3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70"
                >
                  {step === "busy" ? SPINNER : null}
                  {tried ? "Try again" : copy.action}
                </button>
                <button
                  type="button"
                  onClick={notNow}
                  disabled={step === "busy"}
                  className="min-h-12 rounded-lg text-[15px] font-bold text-[#3F4842] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  Not now
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** You's row to Sign-in and security, only where passkeys run (elsewhere You is as it was). */
export function SecurityRow() {
  const { runs } = usePasskeysHere();
  if (!runs) return null;
  return (
    <Link
      href={SECURITY_PATH}
      className={cn(
        "flex min-h-[60px] items-center gap-3 rounded-3xl border bg-card px-5 py-2.5 transition-colors hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-cp-herb-tint text-primary">
        <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold">{SECURITY_TITLE}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
