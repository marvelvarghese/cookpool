"use client";

import * as React from "react";
import { Check, ChevronRight, KeyRound, ScanFace, ShieldCheck } from "lucide-react";
import Link from "./link";
import { cn } from "@/lib/cn";
import { wrap, type ApiClient } from "@/lib/api";
import {
  dismissOffer,
  markDeviceHasPasskey,
  passkeysRunOnThisPage,
  register,
  thisDevice,
} from "@/lib/passkey-device";
import {
  PASSKEY_BUTTON,
  addPasskey,
  offerCopy,
  passkeyDeviceName,
  type AddPasskeyOutcome,
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

/** The ceremony that adds a passkey on this device, through the session's client. */
export function addPasskeyHere(client: ApiClient, device: PasskeyDevice): Promise<AddPasskeyOutcome> {
  return addPasskey({
    registerOptions: () => wrap(() => client.auth.passkeyRegisterOptions()),
    register,
    registerVerify: (input) => wrap(() => client.auth.passkeyRegisterVerify(input)),
    deviceName: passkeyDeviceName(device),
  }).then((out) => {
    // Added here, or this device already holds one: either way the offer never shows here again.
    if (out.kind === "added" || out.kind === "already") markDeviceHasPasskey();
    return out;
  });
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

/**
 * Turn on Face ID (`PasskeyOffer`): a full-screen step after a code or
 * Google sign-in, before landing. Turn on saves a passkey here, then says so
 * and Go on; Not now waits 30 days. The 10-passkey limit or any failure goes
 * on quietly; a closed sheet leaves the offer as it was.
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
  const [step, setStep] = React.useState<"ask" | "busy" | "done">("ask");
  const goRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (step === "done") goRef.current?.focus();
  }, [step]);

  const turnOn = async () => {
    if (step !== "ask") return;
    setStep("busy");
    const out = await addPasskeyHere(client, device);
    if (out.kind === "added") setStep("done");
    else if (out.kind === "cancelled") setStep("ask");
    else onFinish();
  };

  const notNow = () => {
    dismissOffer();
    onFinish();
  };

  return (
    <section
      aria-labelledby="passkey-offer-title"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-[18px] px-6 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-[calc(env(safe-area-inset-top)+56px)]"
    >
      {step === "done" ? (
        <>
          <span aria-hidden className="mt-6 grid h-28 w-28 place-items-center self-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-14 w-14" strokeWidth={2.2} />
          </span>
          <div role="status" className="flex flex-col gap-2 text-center">
            <h1 id="passkey-offer-title" className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em]">
              {copy.doneTitle}
            </h1>
            <p className="text-[15px] leading-normal text-[#3F4842]">{copy.doneBody}</p>
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
          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void turnOn()}
              disabled={step === "busy"}
              aria-busy={step === "busy" || undefined}
              className="flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-primary text-base font-extrabold text-primary-foreground hover:bg-[#165C3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70"
            >
              {step === "busy" ? SPINNER : null}
              {copy.action}
            </button>
            <button
              type="button"
              onClick={notNow}
              disabled={step === "busy"}
              className="min-h-12 rounded-lg text-[15px] font-bold text-[#3F4842] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              Not now
            </button>
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
