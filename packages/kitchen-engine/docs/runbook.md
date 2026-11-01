# kitchen-engine — runbook

Nothing runs: the package ships inside kitchen-worker's bundle (and the console's). A change here does not redeploy its consumers on its own — `orun plan --changed` selects components by path — so a PR that changes the engine must also touch `apps/kitchen-worker` (its component.yaml redeploy line is enough) and, once the console imports it, `apps/web-console-next`.

Tests live in `tests/kitchen-worker/src/engine.test.ts` (property tests over random cases).
