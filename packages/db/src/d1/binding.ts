// Structural types for the Cloudflare D1 binding.
//
// Declared here rather than imported from `@cloudflare/workers-types` so that
// `@saas/db` stays runtime- and dependency-free: the Workers that own the
// binding satisfy these shapes exactly, and tests can hand in a fake without
// pulling the Workers type surface into a plain Node package.

export interface D1Meta {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Binding {
  prepare(query: string): D1PreparedStatement;
  /**
   * D1's atomic statement list: every statement runs in one implicit
   * transaction, and a failure in any of them rolls back all of them. It is
   * the only all-or-nothing write D1 offers (it has no interactive
   * transactions). Optional on the type so a hand-written test binding can
   * omit it; a real D1 binding always has it.
   */
  batch?<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
