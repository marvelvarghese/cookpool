/**
 * A send that waits so Undo is real (spliteco-calm SL2, design §2 "Remind
 * … show Undo"). The server has no unsend for a reminder, so a swiped
 * Remind is held UNDO_MS before the API is called: Undo inside that window
 * means nothing was sent. Leaving the page sends what is still waiting
 * (`flush`), since the person did ask for it. The clock is injected, so the
 * rules are tested without waiting.
 */

export const UNDO_MS = 4000;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class DelayedSends {
  private readonly waiting = new Map<string, { handle: unknown; run: () => void }>();

  constructor(
    private readonly timers: Timers = browserTimers,
    private readonly ms: number = UNDO_MS,
  ) {}

  /** Run `run` after the delay, once per `key`: a second schedule while one waits is ignored (false). */
  schedule(key: string, run: () => void): boolean {
    if (this.waiting.has(key)) return false;
    const handle = this.timers.set(() => {
      this.waiting.delete(key);
      run();
    }, this.ms);
    this.waiting.set(key, { handle, run });
    return true;
  }

  /** Undo: the waiting send for `key` never runs. False when there was none (it already went). */
  undo(key: string): boolean {
    const w = this.waiting.get(key);
    if (!w) return false;
    this.timers.clear(w.handle);
    this.waiting.delete(key);
    return true;
  }

  /** Send now whatever is still waiting (the page is going away). */
  flush(): void {
    const all = [...this.waiting.values()];
    this.waiting.clear();
    for (const w of all) {
      this.timers.clear(w.handle);
      w.run();
    }
  }

  isWaiting(key: string): boolean {
    return this.waiting.has(key);
  }
}
