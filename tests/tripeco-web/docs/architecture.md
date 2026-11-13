# tripeco-web-tests — architecture

Jest (ts-jest, ESM) over the pure modules in `apps/tripeco-web/src/lib` and the Worker's `src/worker/api-forward.mjs`, imported through the `@/` and `@tripeco-web/` path aliases. The split maths is the real `@saas/kitchen-engine/splits`, so a form that passes here is one spliteco-worker accepts.
