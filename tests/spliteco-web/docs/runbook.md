# spliteco-web-tests — runbook

- Run: `pnpm --filter @saas/spliteco-web-tests test` (also `typecheck`, `lint`).
- A failing split-form test usually means the engine's rules changed (`packages/kitchen-engine/src/splits.ts`): the app's Save gate follows them.
