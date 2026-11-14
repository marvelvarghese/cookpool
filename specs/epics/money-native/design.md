# money-native — design

The approved boards are the spec. Where this file and a board differ, the board wins and the difference is a departure in the status file.

## Where things live today

- `/money` renders `MoneyInside` (`apps/web-console-next/src/components/kitchen/money-inside-ui.tsx`), which mounts `SplitecoMoneyTab` from `@saas/spliteco-ui/money-tab-ui` in the fixed Deep ocean of `inside-look.ts`. Settle, + Expense and a whole group hand off to the Spliteco app with a one-time code (`handoffUrlTo`). `tab-bar.tsx` turns the bar navy on `/money`.
- Tripeco's Money tab (`apps/tripeco-web/.../money-tab.tsx`) mounts the same `SplitecoMoneyTab`.
- The package already has the logic this needs, as pure modules: `kitchenFirst`, `checkAmount`, `upiLink`, `payOptions` (`settle.ts`), `moneyTotals`, `withYou` (`money-tab.ts`), `balanceView` (`balance.ts`). It styles through class "slots" (`theme.tsx`), not colour tokens.
- The Add group logic is `new-group-dialog.tsx` and `groups.ts` (`GROUP_CURRENCIES`, `WASTE_RULES`, `validateGroupName`, `groupSlug`); the food rule can be changed on the group settings page (`app/(kitchen)/groups/[orgSlug]/settings`).
- Cookpool's old `MoneyScreen` and Bill were already removed by MN-6. What is "old Money" now is `MoneyInside`, its hand-off, the navy bar, and `money-group-ui.tsx` / `settle-card.tsx` / `/money/settle` (still used by `/people/[id]`, dish and group settings). MY-13 decides each by whether a caller is left.

## Decisions

1. **Native look, one credit.** Cream (`#F6F5F0`), herb green, Cookpool's tab bar with Money as one of its five. "Powered by Spliteco" is one 11px muted line under the Money title, on every Money page that has the title, and no other Spliteco mark anywhere. *Why: the owner's call — Money is a Cookpool room; Spliteco is the engine.*
2. **Groups | People.** One segmented switch; the open side is a tinted block with icon and label, the other folds to its icon. **Groups**: the net, the group rows, a `+ Group` at the top, an `Add group` row at the end, a floating Expense button. **People**: everyone you split with across all groups, `Pay` when you owe, `Got it` when they owe you, a floating `Settle up`. *Why: groups are where money is made, people are who it is settled with.*
3. **One expanding button.** `ExpandButton` in `@saas/spliteco-ui`, kinds `settle` (a person), `expense` (Groups), `people` (People's Settle up). It floats above the tab bar, grows into a box over a dimmed page and shrinks back. Content is passed in as props/children, so the package owns the motion, focus and dimming and the host owns the box's contents. **Reduce motion**: no grow or shrink — the box fades in and out in at most 120ms; focus is trapped while open, Escape and the dim close it, focus returns to the button. *Why: three screens needed it; building it three times would drift.*
4. **Tokens and a `theme` prop.** `look.ts` holds the two token sets from the Theme_Tokens board (bg, surface, ink, muted, line, primary, onPrimary, soft, softInk, get, owe, money, navInk, grab); a `LookScope` sets them as CSS variables. Every page takes `theme: "cookpool" | "spliteco"`, holds no colour of its own, and Deep ocean is built from the existing `SPLITECO_INSIDE`. Cookpool passes `cookpool`; the Spliteco app passes `spliteco`. Dark mode of Cookpool is the host's, not a third theme here.
5. **Add group.** Name; currency (a selectable row; INR by default; a Cookpool group has exactly one currency and every item in it uses it; from Start from Spliteco it defaults to the Spliteco group's main currency and nothing is greyed out; it can be changed later in the group's settings); food that goes off — *Split equally* or *The buyer absorbs it* (`WASTE_RULES`, unchanged); a join link with Copy. **Start from Spliteco** is one row above them that opens a searchable list of the person's Spliteco groups (already-added ones marked *Added*); picking one fills the name — still editable — and the currency, brings its people along, and the food rule is still chosen. **Renaming here is Cookpool-only**: the Spliteco group keeps its name.
6. **Manage group.** People; Simplify debts; Split default; Food that goes off (its own page, Group_Waste); Currency (a selectable row; changing it on a group that already has entries is an open question, see risks); Join link with Copy; Leave group.
7. **Settle records; it does not pay.** The person pays in their own UPI app (`upiLink`) and then taps **Paid**, which records the payment. The box offers **All**, **Kitchen only** or **Custom amount**; Custom is a keypad; the **Kitchen clears first** (`kitchenFirst`), then the other groups. A person's page lists the balance **by group, Kitchen first**. "Simplified" settling means fewer payments, not different money.
8. **Expense: Equal and Exact.** Percent, shares and itemized stay in Spliteco; a group whose split is set that way says so in one quiet line.
9. **Buttons are flat**, 10–12px corners, **one solid herb-green button per screen**; the rest are `soft`.
10. **Old Money goes last** (MY-13), after Cookpool no longer calls it.

## Decisions made while cutting the plan (not on the boards)

- **Which pages are shared.** Groups, People, a person's page, the settle box, the expense box and the button live in `spliteco-ui` (both apps need them). **Add group, Start from Spliteco and Manage group stay in `web-console-next`**: they create and edit Cookpool groups and carry the Kitchen food rule, which Spliteco has no notion of. They read the same tokens. *Confirm with the owner; the boards draw them only in Cookpool's look.*
- **The pages take an `api` prop** (as `SplitecoMoneyTab` does today), so each host passes its own client and nothing in the package imports a host.
- **People reads one new endpoint.** `spliteco-worker` gets one read for everyone's net balance across groups (MY-15, its own backend PR, before MY-5); People does not join client-side. **Got it** records a received payment from them to you and clears the balance at once.
- **Tripeco moves later, in its own epic**, to the new pages with theme `spliteco` (its own tab bar and look). Until then `SplitecoMoneyTab` stays, and this epic does not delete it.
- **No hand-off.** The old tab opened Spliteco to write; native Money writes through the console's own client (`client.spliteco`) and the hand-off code stays only where Spliteco is still opened on purpose ("All splits are in Spliteco").
- **Order: boxes before the mount.** `/money` keeps the old tab until the settle and expense boxes exist (MY-8 after MY-6/7), so stage never loses the ability to settle.

## Rejected

- **Keep one tab, re-skin it with a flag** (`SplitecoMoneyTab` with a `cookpool` colour set). Cheapest, but the new screens are not a re-skin: a Groups | People switch, a person's page, a floating box, and a Spliteco-less page for Cookpool. It would also leave the Powered-by line and the hand-off wired into one component.
- **Copy the screens into web-console-next.** Fast to ship, and it is exactly the two-copies drift `money-inside` rejected. One set of pages with a theme prop is the owner's decision (4).
- **A `theme` per slot class (the existing `SplitecoUiSlots`).** Slots carry Tailwind classes, which the Spliteco app does not have the same way; tokens as CSS variables work in both.
