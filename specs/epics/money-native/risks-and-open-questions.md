# money-native — risks and open questions

**Answered by the owner (2026-11-14):**

- **Currency.** A Spliteco group can hold several currencies; a Cookpool group has exactly one and every item in it uses it. It is picked on Add group (including Start from Spliteco, where nothing is greyed out and the default is the Spliteco group's main currency) and can be changed in the group's settings. It is not fixed once made.
- **People data.** One new read in `spliteco-worker` for everyone's net balance across groups, as its own task and PR before People (MY-15 before MY-5). **Got it** records a received payment from them to you and clears the balance at once.
- **Tripeco.** It moves to the new pages with theme `spliteco`, in a separate epic. `SplitecoMoneyTab` stays until then.

**Open — not decided here (the owner's):**

- **Q1 — Changing a group's currency once it has entries.** Entries are stored in the currency they were made in, so changing it re-labels money. *Default until answered:* allowed only while the group has no money entries; otherwise the setting warns and is blocked, with the reason. Alternatives: convert entries at a rate the owner sets, or start a new group.
- **Q2 — A Spliteco group with several currencies, brought into one Cookpool group.** Start from Spliteco takes the main currency; entries in other currencies need a rule. *Default:* only the main currency's entries come along, and the sheet says so.

**Risks:**

- **"Old MoneyScreen" no longer exists by that name.** MN-6 removed it. Decision 10's target is what is left (`MoneyInside`, the hand-off, the navy bar, and the `money-group-ui` / settle remnants). MY-13 deletes by "no caller is left", and the PR says which stayed.
- **Pages shared vs host-only is an assumption.** Add group, Start from Spliteco and Manage group stay in the console (design §"decisions made while cutting the plan"). If the owner wants them in the Spliteco app too, they move into the package and gain an `api` prop.
- **A multi-group payment is several records.** "All" across groups records one payment per group; there is no atomic multi-group call. If one fails the box says which recorded and which did not, and Paid can be tapped again for the rest.
- **The Kitchen first rule hides how Custom spreads.** The keypad shows the split (as the Settle_Custom board: Kitchen cleared, then Goa trip), so a partial payment is never a surprise.
- **Motion.** The expanding box is the one animated surface; it has a reduce-motion fallback (MY-3) and is checked with the media query forced.
- **Dark.** The boards draw Cookpool light only; Cookpool's dark theme is the host's, and MY-2 maps `cookpool` tokens through it. Check Money in dark before MY-8.
- **The People read is a backend change** (MY-15): contract, route, SDK method and tests; the first worker change in this epic, kept in its own PR so it deploys on its own.
- **Spliteco inside stays reachable for splits we do not support** (percent, shares, itemized): one quiet link, using the existing hand-off, until we decide otherwise.
- **Not seen signed in on stage** until MY-8; the whole epic's native look is verified on stage only after the mount.
