# money-native — risks and open questions

**Open — not decided here (the owner's):**

- **Q1 — A Spliteco group in a currency Cookpool does not offer.** Start from Spliteco (MY-10) carries the currency over, and the currency is fixed once made, but `GROUP_CURRENCIES` is a short list. *Default until answered:* the picker shows such a group greyed with "Currency not available in Cookpool yet", so nothing is created in a currency Cookpool cannot draw. Alternatives: add the currency to the list, or let it through with the code shown.
- **Q2 — A real API for balances by person and for simplified payments.** People (MY-5) needs one net per person across groups with the groups behind it; `SplitecoFriendResponse` already has `byGroup` and `plans` per person, and the groups read has a plan per group, but the friends list is per currency and not one call for everyone. Simplified settling ("fewer payments") is each group's `plan`. *Default:* build People client-side from the groups reads plus `friend`; if that is too many reads, MY-5 stops and asks for one read in `spliteco-worker` (its own PR, not smuggled in). `Got it` needs the same answer: does it record a payment *from* them to you? *Default:* yes, a received payment, as cash received is in Spliteco.
- **Q3 — Tripeco's Money tab uses the same components.** `apps/tripeco-web` mounts `SplitecoMoneyTab` in Deep ocean. *Default:* Tripeco keeps `SplitecoMoneyTab` untouched; MY-13 does not delete it. Alternative: Tripeco moves to the new pages with theme `spliteco` (a task in its own epic, as it needs its own tab bar and a Tripeco look).

**Risks:**

- **"Old MoneyScreen" no longer exists by that name.** MN-6 removed it. Decision 10's target is what is left (`MoneyInside`, the hand-off, the navy bar, and the `money-group-ui` / settle remnants). MY-13 deletes by "no caller is left", and the PR says which stayed.
- **Pages shared vs host-only is an assumption.** Add group, Start from Spliteco and Manage group stay in the console (design §"decisions made while cutting the plan"). If the owner wants them in the Spliteco app too, they move into the package and gain an `api` prop.
- **A multi-group payment is several records.** "All" across groups records one payment per group; there is no atomic multi-group call. If one fails the box says which recorded and which did not, and Paid can be tapped again for the rest.
- **The Kitchen first rule hides how Custom spreads.** The keypad shows the split (as the Settle_Custom board: Kitchen cleared, then Goa trip), so a partial payment is never a surprise.
- **Motion.** The expanding box is the one animated surface; it has a reduce-motion fallback (MY-3) and is checked with the media query forced.
- **Dark.** The boards draw Cookpool light only; Cookpool's dark theme is the host's, and MY-2 maps `cookpool` tokens through it. Check Money in dark before MY-8.
- **Spliteco inside stays reachable for splits we do not support** (percent, shares, itemized): one quiet link, using the existing hand-off, until we decide otherwise.
- **Not seen signed in on stage** until MY-8; the whole epic's native look is verified on stage only after the mount.
