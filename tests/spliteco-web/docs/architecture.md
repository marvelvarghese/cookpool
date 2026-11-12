# spliteco-web-tests — architecture

Jest (ts-jest, ESM) over the pure modules in `apps/spliteco-web/src/lib` and the Worker's `src/worker/api-forward.mjs`, imported through the `@/` and `@spliteco-web/` path aliases. The split maths is the real `@saas/kitchen-engine/splits`, so a form that passes here is one spliteco-worker accepts.
