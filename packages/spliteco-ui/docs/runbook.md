# spliteco-ui — runbook

Nothing runs: the package ships inside the console's and the Spliteco app's bundles. A change here does not redeploy them on its own (`orun plan --changed` selects by path), so a PR that changes it must also touch `apps/web-console-next` and `apps/spliteco-web`.

Tests: `tests/spliteco-ui` (logic and rendered markup), plus the apps' own suites.
