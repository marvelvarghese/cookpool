# gestures — runbook

## How it deploys

It doesn't: it is bundled into spliteco-web and tripeco-web at their build. A change here alone does not redeploy either app — touch the apps' `component.yaml` so the next merge rebuilds them.

## Verify

`tests/spliteco-web`'s gesture suites pass, and both apps typecheck against it.

## Rollback

Revert the commit on `main` and redeploy both apps.
