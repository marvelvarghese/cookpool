// Types for push.mjs (plain JavaScript so the build can bundle it into
// /sw.js). See that file for what each export is.

export declare const NOTIFICATION_ICON: "/icons/icon-192.png";
export declare const NOTIFICATION_BADGE: "/icons/badge-96.png";
export declare const DEFAULT_PATH: "/home";
export declare const GENERIC_TITLE: "Cookpool";
export declare const GENERIC_BODY: string;

export declare function appPath(value: unknown): string | null;

export interface PushNoticeOptions {
  body: string;
  icon: string;
  badge: string;
  renotify: false;
  tag?: string;
  data: { url: string };
}

export declare function pushNotice(payload: string | null | undefined): { title: string; options: PushNoticeOptions };

/** The window clients the handlers use (`WindowClient`). */
export interface PushWindow {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus(): Promise<PushWindow | null | undefined>;
  navigate(url: string): Promise<PushWindow | null>;
  postMessage(message: unknown): void;
}

export interface PushEnv {
  origin: string;
  registration: {
    showNotification(title: string, options?: Record<string, unknown>): Promise<void>;
    pushManager: { subscribe(options: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer | Uint8Array | string }): Promise<unknown> };
  };
  clients: {
    matchAll(options: { type: "window" }): Promise<PushWindow[]>;
    openWindow(url: string): Promise<unknown>;
  };
}

export interface PushHandlers {
  push(payload: string | null | undefined): Promise<void>;
  click(notification: { data?: { url?: unknown } | null; close?(): void } | null | undefined): Promise<void>;
  subscriptionChange(event: { oldSubscription?: { options?: { applicationServerKey?: ArrayBuffer | null } } | null; newSubscription?: unknown } | null | undefined): Promise<void>;
}

export declare function createPushHandlers(env: PushEnv): PushHandlers;
