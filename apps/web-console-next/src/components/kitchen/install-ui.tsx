"use client";

import * as React from "react";
import { ChevronRight, CookingPot, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  ADD_STEP,
  CARD_LINE,
  CARD_TITLE,
  HIDDEN_TOAST,
  INSTALLED_DISPLAY_MODES,
  INSTALLED_KEY,
  INSTALLED_TOAST,
  INSTALL_CHANGE,
  PROMPT_KEY,
  ROW_TITLE,
  SHEET_TITLE,
  cannotInstallLine,
  dayKey,
  hideInstallCard,
  installLabel,
  installMemory,
  installWay,
  iosShareStep,
  isIphoneSafari,
  showInstallCard,
  type InstallEnv,
  type InstallMemory,
  type InstallWay,
} from "@/lib/install";
import { CLOSE_44, K_BUTTON } from "./kit";

/**
 * Installing Cookpool (cookpool-app PW-2, the `AppInstall` artboard): Home's
 * card, the iPhone sheet with the two steps, and You's "Install the app".
 * The rules are `src/lib/install.ts`; the root layout's script holds the
 * browser's prompt (`src/lib/app-shell.ts`).
 */

/** Chromium's `beforeinstallprompt` event, as the root layout's script keeps it. */
interface PromptEvent extends Event {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const shellWindow = () => window as unknown as Record<string, unknown>;

function readEnv(): InstallEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    INSTALLED_DISPLAY_MODES.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true) || nav.standalone === true;
  return {
    standalone,
    installedNow: shellWindow()[INSTALLED_KEY] === true,
    promptHeld: Boolean(shellWindow()[PROMPT_KEY]),
    promptApi: "onbeforeinstallprompt" in window,
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  };
}

/**
 * How this page can install Cookpool (null until mounted: the pages are
 * prerendered), and `prompt`, which opens the browser's own prompt once.
 * When the browser says the app was installed, a toast says it is on the
 * home screen.
 */
export function useInstall(): {
  way: InstallWay | null;
  userAgent: string;
  prompt: () => Promise<"accepted" | "dismissed" | null>;
} {
  const { toast } = useToast();
  const [env, setEnv] = React.useState<InstallEnv | null>(null);
  // Accepted in the prompt: installing now, so nothing more to offer.
  const [accepted, setAccepted] = React.useState(false);

  React.useEffect(() => {
    const update = () => setEnv(readEnv());
    update();
    window.addEventListener(INSTALL_CHANGE, update);
    const standalone = window.matchMedia?.("(display-mode: standalone)");
    standalone?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener(INSTALL_CHANGE, update);
      standalone?.removeEventListener?.("change", update);
    };
  }, []);

  const installedNow = env?.installedNow === true;
  const said = React.useRef(installedNow);
  React.useEffect(() => {
    if (installedNow && !said.current) toast({ kind: "success", title: INSTALLED_TOAST });
    said.current = installedNow;
  }, [installedNow, toast]);

  const prompt = React.useCallback(async () => {
    const event = shellWindow()[PROMPT_KEY] as PromptEvent | null | undefined;
    if (!event) return null;
    // A prompt can be shown once; the browser offers a new one on a later page load.
    shellWindow()[PROMPT_KEY] = null;
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") setAccepted(true);
      return outcome;
    } catch {
      return null;
    } finally {
      window.dispatchEvent(new Event(INSTALL_CHANGE));
    }
  }, []);

  const way = env ? (accepted ? "installed" : installWay(env)) : null;
  return { way, userAgent: env?.userAgent ?? "", prompt };
}

/** The pot mark, white on herb green: the app's icon, small. */
function AppMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center bg-primary text-primary-foreground", className)}>
      <CookingPot className="h-[58%] w-[58%]" strokeWidth={2} />
    </span>
  );
}

/**
 * Home's card, once: "Install Cookpool · Open it like an app", with Install
 * (Android: the browser's prompt) or How (iPhone: the two steps), and ✕,
 * which hides it for 30 days and says where Install lives now. Shows from the
 * device's second day, never in the installed app. A dismissed prompt and
 * "Got it" hide it too.
 */
export function InstallCard({ className, fresh = false }: { className?: string; fresh?: boolean }) {
  const { way, userAgent, prompt } = useInstall();
  const { toast } = useToast();
  const [state, setState] = React.useState<{ today: string; memory: InstallMemory } | null>(null);
  const [gone, setGone] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  React.useEffect(() => {
    const today = dayKey(new Date());
    setState({ today, memory: installMemory(today) });
  }, []);

  const hide = (sayWhere: boolean) => {
    if (state) hideInstallCard(state.today);
    setGone(true);
    if (sayWhere) toast({ kind: "default", title: HIDDEN_TOAST });
  };

  const install = async () => {
    if (way === "ios") {
      setSheetOpen(true);
      return;
    }
    if ((await prompt()) === "dismissed") hide(false);
  };

  const show = !gone && way !== null && state !== null && showInstallCard(way, state.today, state.memory);

  return (
    <>
      {show && fresh ? (
        // The revamped Home (RV-15, the canvas's HomeRevamp): a borderless card on the token shadow, Install on the tint.
        <section aria-labelledby="install-card-title" className={cn("flex min-h-16 items-center gap-3 rounded-cp-card bg-card py-2.5 pl-3.5 pr-1.5 shadow-cp-card", className)}>
          <AppMark className="h-[42px] w-[42px] rounded-[13px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <h2 id="install-card-title" className="truncate text-base font-medium leading-tight">
              {CARD_TITLE}
            </h2>
            <p className="truncate text-[13px] font-normal text-muted-foreground">{CARD_LINE}</p>
          </div>
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex min-h-11 shrink-0 items-center rounded-[14px] bg-cp-accent-tint px-3.5 text-sm font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {installLabel(way)}
          </button>
          <button
            type="button"
            aria-label="Not now"
            onClick={() => hide(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          </button>
        </section>
      ) : show ? (
        <section
          aria-labelledby="install-card-title"
          className={cn("flex items-center gap-3 rounded-[20px] border bg-card py-3 pl-3.5 pr-1.5 shadow-[0_1px_2px_rgba(23,32,27,0.06)]", className)}
        >
          <AppMark className="h-11 w-11 rounded-[13px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id="install-card-title" className="text-base font-extrabold leading-tight">
              {CARD_TITLE}
            </h2>
            <p className="text-[13px] font-semibold text-muted-foreground">{CARD_LINE}</p>
          </div>
          <Button type="button" onClick={() => void install()} className={cn(K_BUTTON, "shrink-0 px-4 font-extrabold")}>
            {installLabel(way)}
          </Button>
          <button
            type="button"
            aria-label="Not now"
            onClick={() => hide(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          </button>
        </section>
      ) : null}
      {way === "ios" ? (
        <IosInstallSheet open={sheetOpen} onOpenChange={setSheetOpen} userAgent={userAgent} onDone={() => hide(false)} />
      ) : null}
    </>
  );
}

/**
 * You's "Install the app": the same flow as Home's card (the prompt, or the
 * iPhone steps), hidden in the installed app. A browser with nothing to tap
 * says so in one line.
 */
export function InstallRow() {
  const { way, userAgent, prompt } = useInstall();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  if (way === null || way === "installed") return null;
  const line = cannotInstallLine(way);
  const mark = <AppMark className="h-[30px] w-[30px] rounded-[9px]" />;

  return (
    <section aria-label={ROW_TITLE} className="overflow-hidden rounded-3xl border bg-card">
      {line ? (
        <div className="flex min-h-[60px] items-center gap-3 px-5 py-2.5">
          {mark}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold">{ROW_TITLE}</span>
            <span className="text-[13px] text-muted-foreground">{line}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (way === "ios" ? setSheetOpen(true) : void prompt())}
          className="flex min-h-[60px] w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {mark}
          <span className="min-w-0 flex-1 text-[15px] font-semibold">{ROW_TITLE}</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      )}
      {way === "ios" ? <IosInstallSheet open={sheetOpen} onOpenChange={setSheetOpen} userAgent={userAgent} /> : null}
    </section>
  );
}

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto overscroll-contain rounded-t-[28px] border-x-0 bg-card px-5 pt-2.5 shadow-2xl focus:outline-none",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
);

/**
 * iPhone and iPad: there is no prompt, so the sheet draws the two steps —
 * Share, then Add to Home Screen — with iOS's own icons, and "Got it". In
 * Safari on an iPhone an arrow points down to its toolbar. ✕, tapping
 * outside or dragging it down closes it too (the shared sheet, PW-7).
 */
export function IosInstallSheet({
  open,
  onOpenChange,
  userAgent,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAgent: string;
  onDone?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="flex min-h-11 shrink-0 items-center pr-12 text-[22px] font-extrabold tracking-[-0.01em]">
          {SHEET_TITLE}
        </SheetTitle>
        <ol className="mt-3 flex flex-col gap-2.5">
          <Step n={1} text={iosShareStep(userAgent)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="the Share icon">
              <path d="M12 3v12" />
              <path d="M8 7l4-4 4 4" />
              <path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
            </svg>
          </Step>
          <Step n={2} text={ADD_STEP}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="the Add to Home Screen icon">
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </Step>
        </ol>
        <Button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onDone?.();
          }}
          className="mt-4 h-14 shrink-0 rounded-2xl text-base font-extrabold"
        >
          Got it
        </Button>
        {isIphoneSafari(userAgent) ? (
          <svg width="28" height="20" viewBox="0 0 28 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mx-auto mt-3 shrink-0 text-muted-foreground">
            <path d="M14 2v14M6 9l8 8 8-8" />
          </svg>
        ) : null}
        <div aria-hidden className="h-5 shrink-0" />
      </SheetContent>
    </Sheet>
  );
}

function Step({ n, text, children }: { n: number; text: string; children: React.ReactNode }) {
  return (
    <li className="flex min-h-14 items-center gap-3.5 rounded-2xl bg-background px-3.5">
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-sm font-extrabold text-background">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-base font-bold">{text}</span>
      <span className="shrink-0 text-foreground">{children}</span>
    </li>
  );
}
