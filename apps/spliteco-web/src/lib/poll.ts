// The live split's refresh (risk SE-E: polling, no socket). One read now,
// then one every `intervalMs` after the previous read finished (so slow
// answers never pile up), only while the page is visible: hidden, it stops;
// visible again, it reads at once and carries on. `stop()` ends it for good
// (the screen left, or the bill was locked). Pure over its clock and page, so
// tests drive it with fake ones.

export interface PollPage {
  hidden(): boolean;
  /** Call `fn` whenever visibility changes; returns the unsubscribe. */
  onVisibility(fn: () => void): () => void;
}

export interface PollClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Read now (after a claim, say), then keep the rhythm. */
  kick(): void;
  readonly running: boolean;
}

export function createPoller(read: () => Promise<unknown>, intervalMs: number, page: PollPage, clock: PollClock): Poller {
  let started = false;
  let stopped = false;
  let inFlight = false;
  let again = false;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;

  const clear = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (stopped || page.hidden()) return;
    timer = clock.setTimeout(() => {
      timer = null;
      void tick();
    }, intervalMs);
  };
  async function tick(): Promise<void> {
    if (stopped || page.hidden()) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    clear();
    try {
      await read();
    } catch {
      /* the next read tries again */
    } finally {
      inFlight = false;
    }
    if (again) {
      again = false;
      return tick();
    }
    schedule();
  }

  return {
    get running() {
      return started && !stopped && !page.hidden();
    },
    start() {
      if (started || stopped) return;
      started = true;
      unsubscribe = page.onVisibility(() => {
        if (stopped) return;
        if (page.hidden()) clear();
        else void tick();
      });
      void tick();
    },
    stop() {
      stopped = true;
      clear();
      unsubscribe?.();
      unsubscribe = null;
    },
    kick() {
      if (started && !stopped) void tick();
    },
  };
}

/** The browser's page and clock. */
export function browserPage(): PollPage {
  return {
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    onVisibility(fn) {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
  };
}

export const browserClock: PollClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};
