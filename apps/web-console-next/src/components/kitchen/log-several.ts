/**
 * Log several's order (cookpool-pantry PN-5; shared with Say what you used,
 * cookpool-ai AI-7), the pure half: the uses are sent one after another —
 * each waits for the one before it — and the one Undo reverses every one
 * that was written, the last first. `log-several-data.ts` runs it with the
 * SDK and the cache. Dependency-free, so it is unit-testable.
 */

/** Start each send once the one before it has answered; `around` wraps each (the optimistic write's `track`). */
export function sendInOrder<T>(sends: readonly (() => Promise<T>)[], around: (i: number, answer: Promise<T>) => Promise<T> = (_, p) => p): Promise<T>[] {
  let chain: Promise<unknown> = Promise.resolve();
  return sends.map((send, i) => {
    const r = around(i, chain.then(send));
    chain = r;
    return r;
  });
}

/**
 * Undo every written one, the last first (each item's own newest use is the
 * one put back); the refused ones are skipped. Says which were put back and
 * which refused to be.
 */
export async function undoLastFirst<R>(
  answers: readonly R[],
  written: (r: R) => boolean,
  undoOne: (i: number, r: R) => Promise<boolean>,
): Promise<{ undone: number[]; refused: number[] }> {
  const undone: number[] = [];
  const refused: number[] = [];
  for (let i = answers.length - 1; i >= 0; i--) {
    const r = answers[i]!;
    if (!written(r)) continue;
    if (await undoOne(i, r)) undone.push(i);
    else refused.push(i);
  }
  return { undone, refused };
}
