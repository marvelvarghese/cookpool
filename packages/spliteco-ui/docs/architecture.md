# spliteco-ui — architecture

- **Logic, pure:** `money.ts` (Spliteco's formatting and parsing), `settle.ts` (the UPI link, who can be paid, Kitchen first, the Settle up steps), `balance.ts` (the balance card's view-model, Kitchen · Other), `why.ts` (the rows behind a balance, This week and Earlier), `bill.ts` (the add-a-bill form's checks and request).
- **Parts:** `components.tsx` — `BalanceCard`, `BucketLine`, `WhyList`, `AddBillForm`, `PayMethods`, `UpiConfirm`, `SettleUp`. They hold the words, structure and behaviour, and talk to no API: an app passes what it read and is called back to write.
- **Theme:** `theme.tsx` — every class an element takes is a named slot from the app's `SplitecoUiProvider`, and so is the money formatter. The package has no colours, sizes or fonts of its own (pinned by tests/spliteco-ui). Each app defines its theme in its own source, so its Tailwind or CSS sees the classes: `apps/web-console-next/src/components/kitchen/spliteco-theme.ts`, `apps/spliteco-web/src/lib/ui-theme.ts`.
- Source-mode TypeScript with `./*.js` specifiers; both Next apps list it in `transpilePackages`.
