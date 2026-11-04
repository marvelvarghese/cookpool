# Cookpool phone UI audit (390 × 844)

**What was audited:** `apps/web-console-next` at cookpool `main` (9944e28). I rebuilt it with `next build`, then ran it with `next start` and `CONSOLE_WORKERS_DEV_SUBDOMAIN=audit-local-mock-unrouted`, behind the si6 mock proxy. It was driven in the built-in browser at 390×844, DPR 2. I signed in with a fake `audit@cookpool.test` address and the mock's on-screen code. No real API was reached, and the repo is unchanged (`git status` clean).

**Screenshots:** every image lives in this folder. Each is a 468×1013 JPG, the 0.6-scale view of one 844 px phone screen. The file names are cited in each section below.

**How to read the numbers:**
- *Words above the fold* counts the visible text in the first 844 px, including the 5-word tab bar.
- *Page* is the full scroll height. One screen is 844 px.

**Caveats about the data:**
- All data is the harness's mock data, so relative dates ("cooked today/yesterday") depend on when the run happened.
- The mock had no `GET /v1/kitchen/me/people/{id}`. I added a simple version to a scratch copy of the mock, `scratchpad/ux-mock.js`, so the Person page's layout is real but its amounts are made up.
- In the mock, the group balance list covers only 3 of the 5 members.

---

## Global patterns (they show up on almost every screen)

| Pattern | What it looks like | Effect |
|---|---|---|
| **A subtitle under every page title** | "Your kitchen, across every group." · "From any pantry you use. Whoever paid for it is paid back." · "Everyone you share a group with, and where you stand." · "The fewest payments that square everyone up." · "From any pantry. Whoever paid for what you take is paid back." · "A bill in Flat 4B, in INR." | 8–15 words of reading before the first control, on every page. None of them is needed to act. |
| **Captions under controls** | "A usual measure, for just you." / "Your usual amount, for just you." (5× on Home) · "Search every pantry, or tap + Add to log one of your usuals again." · "Enter a quantity and price to see the price per unit." · "Set it once: it can't change after you save." | They explain the app instead of acting, and they repeat. |
| **Meta lines with 4–5 facts joined by dots** | "Flat 4B · 2 of 4 portions claimed · ₹96.00 · cooked today" · "6 items · ₹665.40 · 2 use soon · 1 expired · only you" · "6 items · ₹718.05 · 2 use soon · 5 people · waste split equally" | Dense 12–13 px gray text that wraps to 2 lines at 390 px. |
| **Money-explainer boxes** | "How this moves money / UNTIL FINALIZED" on every dish (3 sub-blocks plus a footnote). The Cook page has a dark 5-line cost card. Settle has "The working: 3 debts → 2 after pairs cancel → 1 payment". | The densest, most jargon-heavy parts of the app. |
| **Jargon** | finalize · Finalize split · claims / Open for claims · **netting** ("After netting inside each group") · "it **nets** with everything else at settle-up" · **the fewest-payments plan** · Fewest payments · "pairs cancel" · Group shortcut · Between you two · "posted when they cooked" · "Settle up **folds** these into everything else" · waste split equally / buyer absorbs waste · Use the group rule · Owner/Admin/Member/**Viewer** · Leftovers · extras · ≈ ₹16.93 | People have to learn a ledger vocabulary just to read a dish. |
| **Three layers of fixed chrome at the bottom** | A sticky action bar (≈60 px), the tab bar (≈70 px) and the + Add button sticking up above it. On Dish, Use, Cook and set-portions screens the sticky bar sits **over** content. | It hides rows: the "Who had it?" chips, the last person's row, the unclaimed note. |
| **Toasts** | Two lines plus Undo and ×: "Logged 1 glass of Milk for you and Anu in Flat 4B. ₹17.00 — it nets with everything else at settle-up." · "Claimed 1 portion of Egg fried rice / You had 1 · you'll owe Meera ₹31.20". The toast fades in on top of the card below it and covers its Finalize / Open buttons (`home-7-claim-toast.jpg`). | A long read for a confirmation, and it blocks taps. |
| **"SOON" placeholders in primary spots** | "Remind group · SOON" in the dish's sticky bar · "Remind · SOON" plus "Reminders arrive soon." on the Person page. | They take up the space of real actions and look disabled. |
| **Three different primary-button colors** | Green on most screens · orange on Cook's sticky CTA, right above the orange + Add button · black for "Settle up" on a finalized dish. | No single "this is the action" signal. |
| **Status chips that look like buttons** | Group → Dishes tab: "Finalize", "Claim", "Split" chips. "Split" on a finalized dish is especially confusing. | People tap the chip, not the row. |
| **Money color** | Blue means owed to you, orange/red means you owe. But "Anu paid you · UPI" shows **−₹400.00 in red** (Home and Group activity). | An incoming payment reads as a loss. |
| **Typography** | Home alone uses 8 sizes (12, 13, 14, 15, 16, 18, 24, 26 px) in weights 400–800. Most body text is 12–15 px gray. | It feels busy, and the small gray captions are hard to read. |
| **Back navigation** | Most pages show "← Parent name". The You page shows only a "<" chevron. | Minor inconsistency. |
| **Empty states** | Use: a "Pick what you used" card with "Tap one of your usuals or search. Then choose how much and who had it — the cost is worked out as you go." (21 words). Cook: "Nothing in it yet. Take things from your own pantry or any group's you cook in — or add something you just bought." Home's inbox when empty (from the source): "All clear / Nothing needs you right now." | Instructional paragraphs where a blank space or a single hint would do. |
| **Card density** | Every block is a white rounded card with 20 px padding inside a 16 px gutter, often nested (a card inside a card on Dish and Cook). | It wastes width and stretches pages. Home is 5.2 screens long. |

**Things that look broken at 390 px:**
1. **Join link wraps in the middle of the code.** The URL breaks as "…/join/KTCH234" with "5" on the next line (Group → Invite; `group-2-invite-rules.jpg`, `group-4-dishes.jpg`).
2. **The sticky bar covers content:**
   - On the cook's open dish it hides half of Meera's row and the unclaimed note peeks out from under it (`dish-cook-1-open-top.jpg`).
   - In set-portions it hides the veena.k row (`dish-cook-3-set-for-everyone.jpg`).
   - On Use (from Pantry), "Log 1 glass" covers **Who had it?**, so you can't see whose names are already picked (`use-7-from-pantry-sticky-covers-who.jpg`).
   - In Cook's ingredient picker it covers the list (`cook-3-picker.jpg`).
3. **Cook's ingredient picker scrolls inside the page scroll** (a scroll area nested in the page), with the sticky CTA on top of it (`cook-3-picker.jpg`).
4. **The + Add sheet is about 92 % of the screen tall.** When it scrolls, its title and close × scroll away (`add-sheet-scrolled.jpg`).
5. **A gray horizontal scrollbar shows under the "Recent and usual" carousel on Use** (`use-1-empty.jpg`).
6. **Item history wraps the unit onto its own line:** "You and Dev Patel used 300 / g" (`item-2-who-history.jpg`).
7. **Both "Who ate?" options look selected on Cook.** After I picked "I'll say who ate what", the other card ("Let Flat 4B claim portions") still had a green tint (`cook-5-assign.jpg`). This needs checking: it may be a focus or hover leftover.
8. **The calendar icon on the "Use by" date field is clipped** at the card edge (`pantry-new-2-put-it-in.jpg`).
9. No page scrolled sideways: `scrollWidth` was 390 on every screen.

---

## 1. Home (`/home`) — used most often

Screenshots: `home-1-top`, `home-2-needs-you`, `home-3-finalize-cards`, `home-4-use-soon-payments`, `home-5-flag-usesoon`, `home-6-activity-bygroup`, `home-7-claim-toast`.

**What it's for:** a daily dashboard, meaning what you owe or are owed plus a to-do inbox. **Primary action:** clear "Needs you" items: log a use, claim a portion, finalize a dish, or pay.

**Size:** **101 words above the fold, 541 in total, 4,365 px tall (5.2 screens).** "Needs you · 13 to do" starts at y≈712, so above the fold you see only the greeting, a search field and the balance card.

**Sentences that explain rather than act:**
- "Your kitchen, across every group."
- "Search every pantry, or tap + Add to log one of your usuals again."
- "₹90.00 to you · ₹27.50 from you" and "$0.00 to you · $25.00 from you" (sub-lines under each headline)
- "A usual measure, for just you." / "Your usual amount, for just you." (5×, one per use-soon card)
- "Just for you: nothing to split." (inside a gray box on the Masala oats card)
- "Once you finalize, they owe you" (on each finalize card)
- "2 portions unclaimed. When you finalize, they stay with you as Leftovers in your pantry: ₹48.00, at ₹24.00 a portion."
- "Flat 4B · say who had how much · ₹50.80 · cooked yesterday"
- "Goa trip · the fewest-payments plan" (on all 3 payment cards)
- "You view Lunch club, so Kiran Rao or an owner or admin records it."
- Each activity row has hidden "Takes ₹6.00 off your balance" text for screen readers. Fine for accessibility, but the visible −₹ already says it.

**Friction:**
- **Duplicated information.** The same three debts (Dev $25, Kiran ₹24, veena ₹3.50) appear **three times**: as person rows in the balance card, as 3 payment cards in Needs you, and partly again in "By group".
  - "Use soon" (Tomatoes strip) repeats the use-soon idea already covered by the inbox cards (Milk, Eggs, Fresh cream).
  - "Recent activity" repeats the group pages.
- **Competing buttons.** The balance card's "Settle up" sits beside per-card "I paid". Each use-soon card has a solid green primary ("I had a cup · ₹60.00") plus "Cook with it". Each finalize card has "Finalize" plus "Open the dish".
- **Two money headlines** in different colors (blue ₹, orange $) with sub-lines. Hard to scan.
- **Inbox cards are 230–330 px tall each.** 13 of them push Activity and By group to screen 4–5.
- **Taps:** quick-log is **1 tap** (good) and claiming is **1 tap** (good, but the 5-chip row None/½/1/1½/2 is tight). Finalize is 1 tap. "I paid" is 1 tap plus a method choice.
- Greek yogurt "expired yesterday" still offers "I had a cup · ₹60.00" as the primary action. Odd for an expired item.

**Doing something for another person:**
- Quick-log buttons are explicitly **"for just you"**. You can't change who had it from Home; you have to go to Use.
- Payment cards: "I paid" records *your* payment. Recording someone else's payment isn't offered here.
- The flag card ("Anu flagged 'Tomatoes'", "I wasn't there for this one — Dev and you had them.", "See the entry") is the only place where a proxy log comes up for review. **Discoverability: low.** It's card 13 of 13, about 3,000 px down.

## 2. Use (`/use`, reached via + Add → "I used something", the Home search, or Pantry → Use)

Screenshots: `use-1-empty`, `use-2-milk-picked`, `use-3-who-had-it`, `use-4-another-amount`, `use-5-logged-toast`, `use-6-search`, `use-7-from-pantry-sticky-covers-who`.

**What it's for:** logging that you (and others) used some of an item. **Primary action:** "Log 1 glass · ₹17.00".

**Size:**
- Empty: **106 words above the fold** (106 in total).
- With an item picked: **132 above the fold, 162 in total**, 1,194 px. The page auto-scrolls by 246 px when you pick an item.

**Explanatory text:**
- "From any pantry you use. Whoever paid for it is paid back."
- "Pick what you used / Tap one of your usuals or search. Then choose how much and who had it — the cost is worked out as you go."
- "1 L left · Meera paid"
- "₹17.00 in all · ₹6.80 per 100 ml, as bought. Split equally; whoever paid is paid back."
- "Up to 1 L, what's left."
- "Enter how much to see who owes what."
- The toast: "Logged 1 glass of Milk for you and Anu in Flat 4B. ₹17.00 — it nets with everything else at settle-up."

**Friction:**
- **Taps:** + Add → I used something → a usual card → Log = **4 taps**, or 3 from Home search plus a result. Good.
- Each preset tile shows 3 facts ("1 glass / 250 ml · ₹17.00"). Fine, but the "YOUR USUAL" badge plus the green fill adds noise.
- "You owe Meera ₹8.50 / Anu owes Meera ₹8.50" and the footnote repeat the ₹17.00 that is already on the button.
- "Another amount" swaps the presets for a field with a "Back to presets" link. It's a second mode to learn.
- **The item page uses a different Use control** (a −/50 g/+ stepper) than this page (presets). Two UIs for the same job.

**Doing something for another person: "Who had it?"** is a chip row (You, Anu, Dev Patel, Meera, veena.k), pre-filled with the last people (You + Anu).
- Visible here **only after scrolling**, at y≈1,000 on a 1,194 px page.
- Arriving from Pantry → Use, the sticky Log button **covers the chips entirely** (`use-7…`), so a one-tap log charges Anu without you seeing it.
- Personal-pantry items hide the row (correct).
- **Discoverability: medium to low.**

## 3. + Add sheet (center tab)

Screenshots: `add-sheet`, `add-sheet-scrolled`.

**What it's for:** the launcher for every "I did something" flow. **Primary actions:** I used something / I cooked / I bought food / I paid a bill.

**Size:** **116 words** in the sheet. The sheet is ~776 of 844 px tall and scrolls a little.

**Explanatory text:**
- "What happened? / Pick what you did, or log one of your usuals again in one tap."
- Tile subtitles: "From any pantry you share" · "Share a dish and its cost" · "Add it to a pantry" · "Split it in a group"
- "Record a payment / Someone paid you back"
- "Invite to a group / Share a group's join link"

**Friction:**
- **8 targets** (4 tiles, 4 "Do it again" rows, plus 2 list rows), on top of the Home tiles that already offer quick-logs.
- **"Do it again" duplicates the Home quick-log buttons** and the Use page's "Recent and usual" carousel: the same usuals in three places.
- The rows show "₹17.00 / Log" in two lines on the right; "Log" in green text is the only cue that it's tappable.
- "Record a payment / Someone paid you back" duplicates Settle → Record.

**Doing something for another person:** a "Do it again" row logs with the last people. The subtitle "Flat 4B · you and Anu" / "you, Anu and Dev Patel" is the only cue, and **one tap logs costs for others**. Discoverable only by reading the gray subtitle.

## 4. Dish (`/dishes/[dishRef]`)

Screenshots, in four states:
- Member, open: `dish-member-1-top`, `dish-member-2-money`
- Cook, open: `dish-cook-1-open-top`, `dish-cook-2-open-money`, `dish-cook-3-set-for-everyone`
- Cook, assign/draft: `dish-cook-4-assign-draft`
- Finalized: `dish-finalized`

**What it's for:**
- For a member: say how much you ate.
- For the cook: see claims and finalize.

**Primary action:**
- Member: claim (the "How much did you have?" chips).
- Cook: "Finalize split".
- Finalized: "Settle up" (a black button).

**Size:**

| State | Words above fold | Words total | Page height |
|---|---|---|---|
| Member | 90 | 176 | 1,487 px |
| Cook, open | 103 | 186 | 1,529 px |
| Cook, draft | 100 | 163 | 1,427 px |
| Finalized | 95 | 204 | 1,651 px |

**Explanatory text:**
- "Meera cooked · shared with Flat 4B · today, 12:45 am"
- "3 ingredients from 2 pantries + ₹10.00 extras"
- "4 portions unclaimed so far. Whatever nobody claims stays with Meera as leftovers."
- "2 portions unclaimed. When you finalize, they stay with you as Leftovers in your pantry: ₹48.00, at ₹24.00 a portion."
- "Flat 4B was emailed when you cooked, so everyone can claim theirs."
- "How this moves money · UNTIL FINALIZED" → "They owe Meera for what they ate" → "Meera owes for items they took (posted when they cooked)" → "After netting inside each group" → "Settle up folds these into everything else in the group and shows the fewest payments."
- "As an owner of Flat 4B, you can set the portions and finalize Meera's dish if it's stuck."
- "You're setting everyone's portions. Saving replaces their claims."
- "Set how much everyone had, then finalize."
- "Posted to Flat 4B 30 Oct, 8:20 am. Changing it later adds a correction; nothing is overwritten."
- "As an owner of Flat 4B, you can correct Dev Patel's dish if it's wrong."

**Friction:**
- **Two claim controls on the member view:** the chip row "How much did you have?" **and** a −/0/+ stepper on the "You" row of "Who had some".
- **Claim status said three ways:** the "Open for claims" badge, "1 of 5 claimed", and the "4 portions unclaimed so far" note.
- **The "How this moves money" box** runs ~60 words in 4 sub-blocks, with arrows like "Meera → Anu · Flat 4B ₹18.40". It's jargon-heavy ("netting", "posted", "folds").
- **The cook's sticky bar wastes half its width on a disabled "Remind group · SOON".**
- **Status words keep changing:** Open for claims / Not split yet / Finalized; claimed / set / Hasn't claimed / Not set; "Each ₹31.20" vs "≈ ₹16.93".
- **Taps:** claiming is 1 tap and finalizing is 1 tap (good). Setting portions for others is: find the link → steppers → Save portions (3+ taps).

**Doing something for another person:**
- **Cook setting others' portions:** "Set everyone's portions yourself" is a **small green text link** below the list and under a gray note (y≈850 of 1,529). **Low discoverability.**
- **Owner/admin acting for a stuck cook:** "Set portions" / "Finalize for Meera" sit at the **very bottom** of the page, after the money box. **Low.**
- **Assign-mode dishes:** a stepper per person is visible straight away. **Good.**
- **Finalized:** "Dev Patel set this · ₹68.50" on veena.k's row shows a proxy entry. Fine.
- A member can't claim for someone else (for example a partner); only the cook or an owner can.

## 5. Pantry (`/pantry`) and Add to pantry (`/pantry/new`)

Screenshots: `pantry-1-top`, `pantry-2-group`, `pantry-new-1-top`, `pantry-new-2-put-it-in`, `pantry-new-3-picker`, `pantry-new-4-group-who-paid-waste`.

### Pantry list

**What it's for:** what's in every pantry and what to use soon. **Primary actions:** "Use" on a card, or "+ Add".

**Size:** **122 words above the fold, 274 in total, 2,028 px.**

**Explanatory text:**
- "15 items · worth ₹1,683.45 and $12.00"
- "Your own items plus every group pantry you're in. Worth is what's left of what was paid."
- "6 items · ₹665.40 · 2 use soon · 1 expired · only you"
- "6 items · ₹718.05 · 2 use soon · 5 people · waste split equally"
- "2 items · ₹300.00 · 2 people · buyer absorbs waste"

**Friction:**
- **Each card carries 8 data points:** name, "400 g of 400 g", category, a date chip, ₹/unit, a progress bar, worth, and a Use button.
- The "Showing All pantries" picker **and** "All items / Use soon · 4 / Expired · 1" filters **and** collapsible group sections make three levels of filtering.
- "Use" goes to /use (good), but there the sticky bar covers "Who had it?" (see Use).

**Doing something for another person:** "Meera paid / Anu paid / you paid" is shown per group item (read-only). There's no action here.

### Add to pantry

**What it's for:** recording a purchase. **Primary action:** "Add to your pantry" / "Add to Flat 4B".

**Size:** 50 words above the fold, 79 in total (personal), 1,265 px. Picking a group adds about 60 words: Who paid plus 3 waste options.

**Explanatory text:**
- "Enter a quantity and price to see the price per unit."
- "Only you can see it. You can still cook with it for any group."
- "Everyone in Flat 4B can see it and use it."
- "Nobody is charged yet. As people use it, you get paid back for what they use."
- "If some of it goes to waste / Use the group rule / Flat 4B says: split equally. / Split it equally / Whatever is thrown away is split across everyone in the group. / I absorb it / Nobody else is charged for waste."

**Friction:**
- **"Put it in" (which pantry) comes last**, but it changes the form (Who paid and the waste options only appear after it). It should come first.
- The group picker has a **search box for 2 groups** ("Search 2 groups").
- 7 category chips, 8 unit chips plus "more", and 2 native date fields make it a long form for "I bought milk".
- **The waste choice offers three radios, two of which are the same thing:** "Use the group rule" (= split equally) and "Split it equally".
- **Taps:** + Add → I bought food → name (typed) → category → quantity (typed) → price (typed) → unit → [Put it in → group] → [who paid] → Add. That's **about 8–10 taps plus 3 typed fields.**

**Doing something for another person:** the **"Who paid?"** chips (You / Anu / Dev / Meera / veena) appear only after you pick a group, at the **bottom of a 2-screen form**. Buying for the group on someone else's card is therefore **hard to discover**.

## 6. Groups, a group, expense, People, a person, Settle

### Groups (`/groups`)

Screenshot: `groups.jpg`.

**What it's for:** a list of your groups and your balance in each. **Primary action:** open a group.

**Size:** **44 words**, one screen. This is the cleanest screen in the app.

**Friction:**
- Search plus "Recent / A–Z" sorting for 3 groups is overkill.
- "Join" and "+ New group" compete in the header.
- The role words "Member / Viewer / Owner" are admin vocabulary.

### A group (`/groups/[orgSlug]`)

Screenshots: `group-1-activity`, `group-2-invite-rules`, `group-3-balances`, `group-4-dishes`.

**What it's for:** one group's balance, activity, balances, pantry and dishes. **Primary actions:** "+ Add expense" / "Settle up".

**Size:** 86 words above the fold, 191 in total, **2,218 px**.

**Explanatory text:**
- "Your balance in Flat 4B"
- "Anyone with this link can join Flat 4B as a member."
- "Food that goes off is shared by everyone in the group."
- "Whoever bought it pays for what goes to waste."
- "Set it once: it can't change after you save."
- "You'll stop seeing Flat 4B. To come back you'll need its join link."
- "Cookpool records payments; the money moves in your UPI, bank or cash."
- "The working: 3 debts → 2 after pairs cancel → 1 payment" plus "Show the debts behind this"

**Friction:**
- **The 4 tabs (Activity / Balances / Pantry / Dishes) switch only the first panel.** Invite, Group rules (waste radios, a currency select, Save rules), Members (5 rows with roles and ⋮ menus) and Leave always render underneath on every tab. That's 2+ screens of settings on the page you use every day.
- The Dishes tab uses status chips that look like buttons (Finalize / Claim / Split).
- The join link wraps mid-code (see the broken list).
- Activity rows have a ⋮ menu (flag/undo). It's not obvious that's how you dispute an entry.

### Add expense (`/groups/[orgSlug]/expense`)

Screenshot: `expense.jpg`.

**Size:** 49 words above the fold, 96 in total, 1,655 px.

**Explanatory text:**
- "A bill in Flat 4B, in INR."
- "Everyone ticked pays the same; any odd paisa goes to whoever's listed first."
- "Enter the amount to see everyone's share."
- "Cooked something? Cook a dish takes the ingredients from your pantries and splits it by portions."

**Friction:**
- The split modes (Equally / Exact / % / Shares) are a power-user segmented control shown by default.
- Mentioning the "odd paisa" is unnecessary.

**Doing something for another person:** "Paid by" chips plus a "Several people paid" toggle, **above the fold. Good.**

### People (`/people`)

Screenshot: `people.jpg`.

**Size:** **78 words**, one screen.

**Explanatory text:** "Everyone you share a group with, and where you stand."

**Friction:** the summary card is an **exact copy of Home's balance card** ("You're owed ₹62.50 / ₹90.00 to you · ₹27.50 from you", "You owe $25.00 / …"). The list repeats Home's person rows. The tab adds little beyond the Home card plus a search box.

### A person (`/people/[subjectId]`)

Screenshots: `person-1-top`, `person-2-why`. Amounts come from my mock extension.

**Size:** 66 words above the fold, 121 in total, 1,545 px.

**Explanatory text:**
- "Across the groups you share"
- "Reminders arrive soon."
- "Why · Flat 4B" → "Between you two −₹528.50" → "Group shortcut +₹618.50 / Dev Patel owes Anu ₹618.50 and Anu owes you, so Dev Patel pays you directly." → "Dev Patel pays you ₹90.00"

**Friction:**
- **Two 2-line headlines in two colors and currencies** ("Dev Patel pays you ₹90.00" / "You pay Dev Patel $25.00").
- A disabled "Remind · SOON".
- Each group block has 4 filter chips (Everything / Dishes / Items used / Bills) that wrap onto 2 lines, for 3 entries.
- The "Group shortcut" explainer is the hardest concept in the app to understand.

**Doing something for another person:** "Record payment" records either direction. Above the fold. **Good.**

### Settle up (`/settle`)

Screenshots: `settle-1`, `settle-2-record`.

**What it's for:** the fewest payments across groups. **Primary action:** "Record" → UPI / Cash / Bank.

**Size:** **86 words above the fold** (87 in total), 1,014 px.

**Explanatory text:**
- "The fewest payments that square everyone up."
- "Cookpool records payments; the money moves in your UPI, bank or cash." This sentence appears **again** inside the Record step as "How was it paid? Cookpool records it; the money moves in your UPI, bank or cash."

**Friction:**
- **A 4-cell grid** (You pay USD / You get back USD / You pay INR / You get back INR) includes a pointless "$0.00".
- Kiran's row has no Record button and **no reason given** (Home explains it; here it's just missing).
- The "Settle up in · All groups" picker adds a third way to scope (Home → Settle, Group → Settle).
- **Taps:** Settle → Record → UPI = **3 taps. Good.**

**Doing something for another person:** the "Dev Patel pays you ₹90.00 · Record" row lets you record the other person's payment. Visible, but at the bottom of the list. **Medium.**

## 7. Item (`/pantry/[itemRef]`)

Screenshots: `item-1-top`, `item-2-who-history`.

**What it's for:** one item's facts, using some, and its history. **Primary action:** "Log 50 g for you".

**Size:** **91 words above the fold, 158 in total, 1,587 px.**

**Explanatory text:**
- "Flat 4B pantry · Veg · Anu paid"
- "No dish needed. A snack, a salad, a glass of milk all count."
- "All that's left · 400 g"
- History: "Dev Patel used 200 g · logged by Anu", "Anu undid a use: 100 g back"

**Friction:**
- **A 6-cell stats grid with duplicates:** "Price paid ₹40.00 by Anu" repeats the subtitle's "Anu paid". "Costs ₹4.00 per 100 g" and "Price per unit ₹40.00/kg" are the same fact. "Bought on" and "If wasted" are rarely needed.
- The Use control here is a stepper, while /use has presets.
- **The button label ignores who had it:** it says "Log 50 g for you" even though "Who had it?" is a multi-select.
- "Cook with it" and "Mark wasted" are full-width secondaries under the card.

**Doing something for another person:** the "Who had it?" chips sit **below the fold** (y≈880). History shows "logged by Anu" (good transparency) and "Undo" on each row. **Medium.**

## 8. Cook (`/cook`)

Screenshots: `cook-1-empty`, `cook-2-who-ate`, `cook-3-picker`, `cook-4-ingredient`, `cook-5-assign`.

**What it's for:** building a dish from pantry items and sharing its cost. **Primary action:** the sticky orange CTA. It turns into the next missing step: "Add an ingredient" → "Name the dish" → …

**Size:** 94 words above the fold, 159 in total (empty), 1,453 px. It grows to **2,504 px** with one ingredient plus assign mode.

**Explanatory text:**
- "From any pantry. Whoever paid for what you take is paid back."
- "Nothing in it yet. Take things from your own pantry or any group's you cook in — or add something you just bought."
- "You take on, for items from group pantries / Nothing: no one else paid for anything in it."
- "5 people · they owe you for what they eat"
- "Let Flat 4B claim portions / People tap how much they had. You finalize once everyone has eaten."
- "I'll say who ate what / Pick people and portions now. The split posts with the dish; you finalize it on the dish page."
- "Nobody's down for 3 portions yet (₹5.10). They fall to you, and become leftovers in your pantry once you finalize."
- "Whoever eats owes you ₹1.70 a portion. Inside Flat 4B, that cancels against the ₹6.80 you owe Meera, so settle-up only shows what's left."

**Friction:**
- **A dark 5-line cost card:** Dish total, Each portion ÷ 4, From your own pantry, Extras you paid, You take on….
- **The ingredient picker is a scroll list inside the page**, and the sticky CTA covers it.
- **The orange sticky CTA sits right above the orange + Add button.**
- **Taps:** + Add → I cooked → name → Add from any pantry → Add ×n → quantity ×n → portions → share-with → who ate → Cook. That's **10+ taps** for a 2-ingredient dish.
- A "Back" link plus the tab bar means the flow doesn't feel modal.

**Doing something for another person:** "I'll say who ate what" opens a stepper for each member with live ₹. Discoverable, but it's the second radio, below the fold, after a 4-line description. **Medium.**

## 9. You (`/you`)

Screenshot: `you.jpg`.

**What it's for:** your name and signing out. **Primary action:** "Change your name".

**Size:** **50 words**, one screen.

**Explanatory text:**
- "Your groups see this name next to what you buy, use and cook."
- "HOW YOU SIGN IN / A code to … / Last used"
- "Your groups, pantry and balances stay as they are."

**Friction:**
- It's only reachable through the "RV" avatar on Home. There's no tab, and other pages have no avatar.
- A "Last used" badge on the only sign-in method.
- Back is a bare "<".

## 10. Sign in (`/login`)

Screenshots: `login`, `login-code`.

**What it's for:** signing in with an email code. **Primary action:** "Email me a code", then "Sign in".

**Size:** about 35 words.

**Explanatory text:**
- "Sign in, or make your account. It's the same step."
- "By continuing you agree to the Terms and the Privacy notice."
- "We sent a 6-digit code to … It works for 10 minutes."
- "No email? Check your spam folder."

**Friction:**
- A "Developer sign-in" link is visible under the form. I couldn't check whether production hides it.
- Otherwise clean: 2 steps, and the code auto-submits on 6 digits.

---

## Top 15 simplifications

1. **Home: make "Needs you" a compact list.** One line per item ("Milk · use by tomorrow — [1 glass]"), with at most 3 shown and "See all 13". Drop every per-card caption ("A usual measure, for just you.", "Just for you: nothing to split.", "Once you finalize, they owe you"). This cuts Home from 5.2 screens to about 2.
2. **Home: show each debt once.** Keep one balance line per currency plus "Settle up". Remove the person rows from the balance card (the payment cards already carry them) and drop "By group" (the Groups tab has it). Delete "Your kitchen, across every group." and the search-helper sentence.
3. **Use and Item: make "Who had it?" impossible to miss.** Put the avatars inside the button ("Log 1 glass · You + Anu · ₹17") and never let the sticky bar cover the chips. Use one Use component (presets plus "Other") on both /use and the item page. Remove "Pick what you used / Tap one of your usuals…" and the page subtitle.
4. **Dish: replace "How this moves money" with a single plain line.** For example "You'll get ₹24 from Anu · you owe Dev ₹30", with a "Details" disclosure. Remove "netting", "posted when they cooked" and "folds these into".
5. **Dish (member): keep one claim control.** Keep the "How much did you have?" chips and remove the stepper on the "You" row. Merge "Open for claims", "1 of 5 claimed" and "4 portions unclaimed so far…" into one progress line.
6. **Dish (cook or owner): give "set for others" an icon.** Replace the "Set everyone's portions yourself" text link and the bottom-of-page owner block with a pencil icon on the "Who had some" header. Drop "Remind group · SOON" from the sticky bar so "Finalize" can be full width.
7. **+ Add sheet: icons and verbs only.** Remove the subtitle and the 4 tile subtitles. Show the people a "Do it again" row logs for as avatars, not a gray "you, Anu and Dev Patel". Pin the title and × when the sheet scrolls. Remove "Record a payment" (Settle has it).
8. **Pantry list: one-line cards.** Name, "400 g left", the date chip and a Use icon. Move ₹/unit, worth and category to the item page. Delete "Your own items plus every group pantry you're in. Worth is what's left of what was paid." and shorten section meta to "6 items".
9. **Item page: trim the stats grid.** Cut it to 2 facts (Left, Worth) with "More" for the rest. Remove the duplicates ("Costs ₹4.00 per 100 g" vs "₹40.00/kg"; "Anu paid" vs "₹40.00 by Anu") and "No dish needed. A snack, a salad…".
10. **Add to pantry: ask "Put it in" first, then Who paid.** Replace the 3 waste radios with one toggle ("Group shares waste"), defaulted from the group rule. Drop "Enter a quantity and price to see the price per unit." and the search box in a 2-group picker.
11. **Group page: move settings out.** Put Invite, Group rules, Currency, Members and Leave on a gear/Settings screen; the group page becomes balance + tabs. Show the join code with Copy/Share instead of the wrapping URL. Drop group search and Recent/A–Z below ~6 groups.
12. **Merge People and Settle.** People already lists who pays whom, so put "Record" next to each amount there and retire the separate Settle page's 4-cell currency grid and its repeated disclaimer. Hide "Fewest payments / 3 debts → 2 after pairs cancel → 1 payment" behind "Why this amount?".
13. **Cook: compress the cost card and the radio copy.** Cut the dark 5-line card to "₹X total · ₹Y a portion". Shorten the "Who ate?" radios to "Everyone claims" / "I'll assign". Show the ingredient picker as a full-screen sheet, not a nested scroll list. Use the standard green primary for the CTA, not orange right above the orange + Add button.
14. **Toasts: one short line plus Undo.** For example "Logged · You + Anu · ₹17 — Undo", with no "it nets with everything else at settle-up". Place toasts above the sticky bar so they don't cover the card underneath (Home claim toast, Use log toast).
15. **Global: cut visual and verbal variety.**
    - Use one primary color.
    - Remove all "SOON" placeholders (Dish, Person).
    - Show incoming payments in blue/positive, not "−₹400.00" in red.
    - Swap role words for plain ones ("can only view" instead of "Viewer").
    - Go from 8 type sizes to 4.
    - Drop page subtitles everywhere they only restate the title.
