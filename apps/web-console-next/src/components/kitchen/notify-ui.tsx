"use client";

import * as React from "react";
import Link from "./link";
import { Bell, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationKind, NotificationPreference } from "@saas/contracts/notifications";
import { cn } from "@/lib/cn";
import { newFrame } from "@/lib/features";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { trackWrite } from "@/lib/optimistic";
import { refuseIfOffline } from "@/lib/connection";
import {
  BADGE_ROW,
  BLOCKED_LINE,
  EMAIL_LINE,
  INSTALL_FIRST_LINE,
  NOTIFY_TITLE,
  NOT_YET_LINE,
  NO_PUSH_LINE,
  pushRows,
  SEND_TEST,
  TURN_OFF_FAILED,
  TURN_ON_FAILED,
  badgeAsksPermission,
  badgeRowShown,
  kindsOn,
  notifyDevice,
  pushView,
  shownOn,
  testOutcome,
  turnKindOff,
  turnKindOn,
  withPushRow,
  type DeviceState,
  type NotifyEnv,
  type PushServerPort,
} from "@/lib/push";
import { browserDevice, notificationPermission, readDeviceState, readNotifyEnv, setBadgeOn } from "@/lib/push-device";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { IosInstallSheet } from "./install-ui";
import { WORKER_ON, useBadgeSwitch } from "./notify-device";
import { K_BUTTON, K_BUTTON_QUIET, K_CARD } from "./kit";

/**
 * You → Notifications (cookpool-app PW-6, the `AppNotify` artboard): the
 * three kinds and the icon badge, each a switch with its one-line example,
 * all off until turned on. Turning a kind on is what asks the phone for
 * permission — never on load. The rules are `src/lib/push.ts`.
 */

// RV-18: the kit's card (no border, the soft shadow).
const CARD = K_CARD;

/** The canvas's switch: 52×32, the knob sliding 20px. */
function NotifySwitch({ on, label, busy, onChange }: { on: boolean; label: string; busy?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-8 w-[52px] shrink-0 cursor-pointer rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        on ? "bg-primary" : "bg-input",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[3px] top-[3px] h-[26px] w-[26px] rounded-full bg-cp-card shadow-cp-card transition-transform motion-reduce:transition-none",
          on && "translate-x-5",
        )}
      />
    </button>
  );
}

function SwitchRow({ title, example, last, children }: { title: string; example: React.ReactNode; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-h-16 items-center gap-3 py-2", !last && "border-b border-cp-line")}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-medium">{title}</span>
        <span className="text-[13px] font-normal text-muted-foreground">{example}</span>
      </div>
      {children}
    </div>
  );
}

/** The badge row's example: the count as the icon would show it. */
function BadgeExample() {
  return (
    <span className="mt-0.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-cp-expired px-1.5 text-xs font-medium text-cp-expired-tint">
      <span className="sr-only">For example </span>
      {BADGE_ROW.example}
    </span>
  );
}

/** You's row: opens this page. */
export function NotificationsRow() {
  return (
    <Link
      href="/you/notifications"
      className="flex min-h-[60px] items-center gap-3 rounded-cp-card bg-card px-5 py-2.5 shadow-cp-card transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-cp-herb-tint text-primary">
        <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-medium">{NOTIFY_TITLE}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** The page's body, below its header. */
export function NotificationsScreen() {
  const [env, setEnv] = React.useState<NotifyEnv | null>(null);
  const [ua, setUa] = React.useState("");
  React.useEffect(() => {
    setEnv(readNotifyEnv(WORKER_ON));
    setUa(navigator.userAgent);
  }, []);
  const { client } = useSession();
  const device = env ? notifyDevice(env) : null;
  const key = useApiQuery(qk.pushKey(), () => wrap(() => client.notifications.pushKey()), { enabled: device === "push" });
  const view = device
    ? pushView(device, { publicKey: key.data ? key.data.publicKey : undefined, failed: !key.data && !!key.error })
    : "loading";
  const [blocked, setBlocked] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const badgeRow = env !== null && badgeRowShown(env) ? <BadgeSwitchRow env={env} onBlocked={() => setBlocked(true)} /> : null;

  return (
    <>
      {view === "install-first" ? (
        <section aria-label="Install first" className={cn(CARD, "flex flex-col gap-3 p-4")}>
          <span className="text-base font-medium">{INSTALL_FIRST_LINE}</span>
          <Button type="button" onClick={() => setSheetOpen(true)} className={cn(K_BUTTON, "self-start px-4")}>
            How
          </Button>
          <IosInstallSheet open={sheetOpen} onOpenChange={setSheetOpen} userAgent={ua} />
        </section>
      ) : view === "switches" && key.data?.publicKey ? (
        <PushSwitches publicKey={key.data.publicKey} badgeRow={badgeRow} blocked={blocked} setBlocked={setBlocked} />
      ) : view === "loading" ? (
        <Skeleton aria-hidden className="h-[264px] w-full rounded-cp-card" />
      ) : view === "error" ? (
        <RetryCard onRetry={key.reload} />
      ) : (
        <>
          <p className={cn(view === "no-push" ? "text-[15px] font-medium" : "text-[13px] font-normal text-muted-foreground")}>
            {view === "no-push" ? NO_PUSH_LINE : NOT_YET_LINE}
          </p>
          {badgeRow ? <section aria-label="What to tell you" className={cn(CARD, "px-4 py-1")}>{badgeRow}</section> : null}
        </>
      )}
      {blocked && view !== "switches" ? <BlockedLine /> : null}
      <p className="text-[13px] font-normal text-muted-foreground">{EMAIL_LINE}</p>
    </>
  );
}

function BlockedLine() {
  return (
    <p role="status" className="text-[13px] font-normal text-destructive">
      {BLOCKED_LINE}
    </p>
  );
}

function RetryCard({ onRetry }: { onRetry: () => void }) {
  return (
    <section className={cn(CARD, "flex flex-wrap items-center justify-between gap-3 p-4")}>
      <span className="text-[15px] font-medium">Couldn&apos;t load your notifications</span>
      <Button variant="outline" className={K_BUTTON_QUIET} onClick={onRetry}>
        Try again
      </Button>
    </section>
  );
}

type PrefsRead = { preferences: NotificationPreference[] };

/** The three kinds (and the badge), once the server's key is known. */
function PushSwitches({
  publicKey,
  badgeRow,
  blocked,
  setBlocked,
}: {
  publicKey: string;
  badgeRow: React.ReactNode;
  blocked: boolean;
  setBlocked: (b: boolean) => void;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prefs = useApiQuery<PrefsRead>(qk.pushPrefs(), () => wrap(() => client.notifications.getPreferences({ channel: "push" })));
  const [deviceState, setDeviceState] = React.useState<DeviceState | null>(null);
  const [flipping, setFlipping] = React.useState<Partial<Record<NotificationKind, boolean>>>({});
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void readDeviceState().then((s) => {
      if (live) setDeviceState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  if (prefs.loading || !deviceState) return <Skeleton aria-hidden className="h-[264px] w-full rounded-cp-card" />;
  if (!prefs.data) return <RetryCard onRetry={prefs.reload} />;

  const kinds = kindsOn(prefs.data.preferences);
  const server: PushServerPort = {
    subscribePush: (s) => client.notifications.subscribePush(s),
    setPushKinds: (k) => client.notifications.setPushKinds(k),
  };
  const settle = (kind: NotificationKind) =>
    setFlipping((f) => {
      const next = { ...f };
      delete next[kind];
      return next;
    });
  const keep = (row: NotificationPreference) => qc.setQueryData<PrefsRead>(qk.pushPrefs(), (d) => withPushRow(d, row));

  // Shown at once (SM-5): the switch moves now, and goes back exactly as it
  // was if the phone or the server says no. The write is counted as on its
  // way, so the update offer waits for it.
  const flip = (kind: NotificationKind, on: boolean) => {
    if (flipping[kind] !== undefined || refuseIfOffline()) return;
    setBlocked(false);
    setFlipping((f) => ({ ...f, [kind]: on }));
    if (on) {
      // Called in the tap itself: its first step is the permission prompt.
      const job = turnKindOn(kind, publicKey, browserDevice, server);
      void trackWrite(qc, job).then((r) => {
        settle(kind);
        if (r.ok) {
          keep(r.preference);
          setDeviceState({ permission: "granted", endpoint: r.endpoint });
        } else if (r.reason === "blocked") {
          setBlocked(true);
          setDeviceState((s) => (s ? { ...s, permission: "denied" } : s));
        } else if (r.reason === "failed") {
          toast({ kind: "error", title: TURN_ON_FAILED });
        }
      });
      return;
    }
    void trackWrite(qc, turnKindOff(kind, server)).then((row) => {
      settle(kind);
      if (row) keep(row);
      else toast({ kind: "error", title: TURN_OFF_FAILED });
    });
  };

  const shown = pushRows(newFrame()).map((row) => ({ ...row, on: shownOn(row.kind, kinds, deviceState, flipping[row.kind]) }));
  const anyOn = shown.some((row) => row.on && flipping[row.kind] === undefined);

  const sendTest = async () => {
    if (testing || refuseIfOffline()) return;
    setTesting(true);
    const r = await wrap(() => client.notifications.sendTestPush(deviceState.endpoint ?? undefined));
    setTesting(false);
    const outcome = testOutcome(r.ok ? r.data : null);
    toast({ kind: outcome.ok ? "success" : "error", title: outcome.title });
  };

  return (
    <>
      <section aria-label="What to tell you" className={cn(CARD, "px-4 py-1")}>
        {shown.map((row, i) => (
          <SwitchRow key={row.kind} title={row.title} example={row.example} last={!badgeRow && i === shown.length - 1}>
            <NotifySwitch on={row.on} label={row.title} busy={flipping[row.kind] !== undefined} onChange={(on) => flip(row.kind, on)} />
          </SwitchRow>
        ))}
        {badgeRow}
      </section>
      {blocked ? <BlockedLine /> : null}
      {anyOn ? (
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testing}
          className="-my-1 min-h-11 self-start rounded-lg px-1 text-[15px] font-medium text-cp-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {SEND_TEST}
        </button>
      ) : null}
    </>
  );
}

/**
 * "To-dos on the app icon": this device only, no server. In WebKit the icon
 * shows a badge only with notification permission, so there turning it on
 * asks for it too.
 */
function BadgeSwitchRow({ env, onBlocked }: { env: NotifyEnv; onBlocked: () => void }) {
  const on = useBadgeSwitch();
  const [asking, setAsking] = React.useState(false);
  const flip = (next: boolean) => {
    if (asking) return;
    if (!next || !badgeAsksPermission(env) || typeof Notification === "undefined" || notificationPermission() === "granted") {
      setBadgeOn(next);
      return;
    }
    setAsking(true);
    void Notification.requestPermission()
      .then((answer) => {
        if (answer === "granted") setBadgeOn(true);
        else if (answer === "denied") onBlocked();
      })
      .catch(() => undefined)
      .finally(() => setAsking(false));
  };
  return (
    <SwitchRow title={BADGE_ROW.title} example={<BadgeExample />} last>
      <NotifySwitch on={on || asking} label={BADGE_ROW.title} busy={asking} onChange={flip} />
    </SwitchRow>
  );
}
