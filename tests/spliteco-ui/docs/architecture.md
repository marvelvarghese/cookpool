# spliteco-ui-tests — architecture

Jest with ts-jest (ESM) over `src/**/*.test.ts(x)`; React parts are rendered with `react-dom/server`'s `renderToStaticMarkup` under a theme whose slots name themselves, so the markup shows which slot each element took.
