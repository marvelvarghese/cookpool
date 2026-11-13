# gestures — architecture

- **Rules, pure:** `gestures.ts` (following one finger: the decide distance, pull, edge back, sheet drag), `row-gestures.ts` (a row's swipe and hold, the click guard), `rules.ts` (the pager, reveal-or-fire, hold, sheet drag, edge back and slider rules, and the settle timing). No DOM beyond the events passed in, so they are tested in node.
- **React helpers:** `react/` — `usePager`, `SwipeRow`, `useHold`, `usePull`, `useSheetDrag`, `useEdgeBack`, `Slider`, `useRepeat`, and the motion constants. They carry no colours or fonts: the class names they set (`.swipe-row`, `.slider`…) are styled by each app's own CSS.
- No gesture or animation library: screens move with CSS transforms. Every gesture has a tap twin in the app that uses it.
- Source-mode TypeScript with `./*.js`-free relative imports; both Next apps list it in `transpilePackages`.
- Tested in `tests/spliteco-web` (`gestures`, `row-gestures`, `gesture-rules`), which import it from here.
