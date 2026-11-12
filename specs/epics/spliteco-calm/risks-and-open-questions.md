# spliteco-calm — risks and open questions

## SL-A — two copies of the gesture modules (ACCEPTED)

`apps/spliteco-web/src/lib/gestures/` copies Cookpool's `lib/gestures.ts` and `lib/row-gestures.ts`. A fix to one does not reach the other. Mitigation: each copy's header names its source. Later, a task can move both into a shared package with their tests.

## SL-B — a row swipe against the tab swipe (RISK, mitigated)

Home has both. Mitigation: a drag that starts on a row and goes left is the row's; one that goes right, or starts off a row, is the pager's (as in Cookpool). The tests pin the rule.

## SL-C — swipe to delete by accident (RISK, mitigated)

Mitigation: a short swipe only reveals the action; it fires past 40 % of the width or on a flick. Delete shows Undo for 4 seconds, and a deleted expense is restorable for 30 days anyway.

## SL-D — the slider and screen readers (RESOLVED)

The slider is a `role="slider"` that also records on Enter or Space, so it needs no drag.

## SL-E — iOS edge swipe (ACCEPTED)

iOS Safari's own back swipe can win over the page's edge swipe in a browser tab. In the installed app (standalone) the page's swipe runs. The ← button always works.
