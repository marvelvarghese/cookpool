import type { D1Binding, D1PreparedStatement } from "./binding.js";
import { toBindValue, translatePlaceholders } from "./sql.js";

export interface SqlRow {
  [column: string]: unknown;
}

export interface SqlExecutorResult<T extends SqlRow = SqlRow> {
  rows: T[];
  rowCount: number;
}

/** One statement of a batch: the same `$n` text and params `execute` takes. */
export interface SqlStatement {
  text: string;
  params?: unknown[];
}

export interface SqlExecutor {
  execute<T extends SqlRow = SqlRow>(
    text: string,
    params?: unknown[],
  ): Promise<SqlExecutorResult<T>>;
  /**
   * Run a list of statements decided up front, ATOMICALLY: all of them apply
   * or none do, and the results come back in order. This is how a write that
   * spans tables stays all-or-nothing on D1, which has no data-modifying CTEs
   * and no interactive transactions. Optional so stub executors in unit tests
   * need not implement it — `executeBatch` falls back to running them in
   * order, which is enough to assert the SQL but promises no atomicity.
   */
  batch?(statements: SqlStatement[]): Promise<SqlExecutorResult[]>;
}

/**
 * Run `statements` through the executor's atomic `batch` when it has one, and
 * in order through `execute` otherwise (stub executors in unit tests).
 */
export async function executeBatch(
  executor: SqlExecutor,
  statements: SqlStatement[],
): Promise<SqlExecutorResult[]> {
  if (executor.batch) return executor.batch(statements);
  const results: SqlExecutorResult[] = [];
  for (const statement of statements) {
    results.push(await executor.execute(statement.text, statement.params));
  }
  return results;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<T>(fn: (executor: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface SqlExecutorFactory {
  create(binding: D1Binding): SqlExecutor & { dispose(): Promise<void> };
}

/**
 * The one seam every repository talks to, backed by Cloudflare D1.
 *
 * D1 is a binding, not a connection: there is no pool to size, no socket to
 * reuse across requests, and nothing to dispose. `dispose()` is kept on the
 * shape so callers (and their `finally` blocks) are identical whatever backs
 * the executor.
 *
 * `rowCount` is `rows.length`, deliberately: statements whose outcome the
 * caller inspects use `RETURNING`, so the count is the number of rows the
 * statement actually produced. D1's `meta.changes` is not substituted for it —
 * that would silently change what `rowCount === 0` means for every existing
 * repository check.
 */
export function createSqlExecutor(
  binding: D1Binding,
): TransactionalSqlExecutor & { dispose(): Promise<void> } {
  async function execute<T extends SqlRow = SqlRow>(
    text: string,
    params?: unknown[],
  ): Promise<SqlExecutorResult<T>> {
    const { text: sql, values } = translatePlaceholders(text, params ?? []);
    const statement = binding.prepare(sql);
    const bound = values.length > 0 ? statement.bind(...values.map(toBindValue)) : statement;
    const result = await bound.all<T>();
    const rows = (result.results ?? []) as T[];
    return { rows, rowCount: rows.length };
  }

  function prepare(text: string, params?: unknown[]): D1PreparedStatement {
    const { text: sql, values } = translatePlaceholders(text, params ?? []);
    const statement = binding.prepare(sql);
    return values.length > 0 ? statement.bind(...values.map(toBindValue)) : statement;
  }

  async function batch(statements: SqlStatement[]): Promise<SqlExecutorResult[]> {
    if (!binding.batch) {
      // Every real D1 binding has batch(); only a test double lacks it. Refuse
      // rather than quietly running the statements one by one, because the
      // caller asked for atomicity and would not get it.
      throw new Error("d1: this binding has no batch() — an atomic statement list cannot run on it");
    }
    const results = await binding.batch(statements.map((s) => prepare(s.text, s.params)));
    return results.map((result) => {
      const rows = (result.results ?? []) as SqlRow[];
      return { rows, rowCount: rows.length };
    });
  }

  return {
    execute,
    batch,

    /**
     * D1 HAS NO INTERACTIVE TRANSACTIONS. Cloudflare's SQLite exposes atomic
     * `batch()` for a statement list decided up front; it cannot hold a
     * transaction open across the reads-then-writes a callback performs.
     *
     * So this runs the callback's statements in order against the same
     * database, with no rollback: a failure part-way leaves the earlier
     * statements applied. Callers that need all-or-nothing must reach for a
     * shape D1 can honor — a single statement with `RETURNING`, an upsert with
     * `ON CONFLICT`, or a compensating write on the error path.
     *
     * Kept as a method (rather than deleted) so the boundary stays visible in
     * the code that needs it: every `transaction(...)` call site is a place
     * where atomicity was wanted, and is where a reviewer should look first.
     */
    async transaction<T>(fn: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      return fn({ execute, batch });
    },

    async dispose(): Promise<void> {
      // No connection to release — D1 bindings are stateless per request.
    },
  };
}
