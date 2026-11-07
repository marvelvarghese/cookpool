# cookpool-app (PW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| PW0 — the spec | ✅ shipped 2026-11-05 | #45 (PW-1) |
| PW1 — an app on your home screen | ✅ shipped 2026-11-07 | #50 (PW-2), #55 (PW-3) |
| PW2 — no signal, clean updates | ✅ shipped 2026-11-06 | #48 (PW-4) |
| PW3 — notifications | ✅ built 2026-11-07; push off until the VAPID keys are stored | #52 (PW-5), #56 (PW-6) |
| PW4 — gestures | ✅ shipped 2026-11-07 | #57 (PW-8), PW-7 |

## Departures from the design

### PW1 — worth installing (PW-2)

- **The card's second line is "Open it like an app"** (design §2), not the canvas's "Full screen · works offline": nothing works offline until PW-4.
- **No rubber-band only in the installed app.** `overscroll-behavior: none` on `html, body` applies under `display-mode: standalone` (and fullscreen, minimal-ui). In a browser tab the browser keeps its own pull-to-refresh, which installed iPhone apps lose and PW4 replaces.
- **The first iPhone step follows Safari's version.** Safari 26 moved Share into the ··· menu of its compact tab bar, so there step 1 reads "Tap ··· then Share"; earlier Safari and the other iOS browsers read "Tap Share". An app's own web view (Instagram, Facebook) gets no card.
- **Hidden for 30 days by more than ✕.** Dismissing Android's prompt, or "Got it" on the iPhone steps, also hides the card for 30 days. Chrome offers a new prompt on the next page load, and Safari cannot tell us it was added, so either would bring the card back the next day otherwise. You keeps "Install the app" any time.
- **A browser with no prompt says what it can do.** You's row reads "Install it from your browser's menu." on Chromium before it offers its prompt and on Android browsers without one, and "This browser can't install Cookpool." elsewhere (Firefox or Safari on a computer). Home shows no card for either.
- **The browser's own install banner never shows.** The root layout's inline script (`src/lib/app-shell.ts`) takes `beforeinstallprompt` on every page, before React mounts, so the one invitation is Home's card. The same script keeps a focused text field above the keyboard (the shared helper for the keyboard rule).
- **The first day is the first day Home opens** on the device (Home is the start page). It is stored per device in localStorage, kept on sign-out, and the first browser session never shows the card even past midnight.
- **Shortcut icons are the + Add tiles'.** They use the same lucide icons in the same tint colours (Used, Bought, Cooked). Each is one 96 px PNG declared `any maskable`, drawn full-bleed with the glyph inside the safe zone.
- **Splash screens are committed, not built.** `scripts/gen-icons.mjs` draws them from the icon on `#F6F7F4`, like the icons since CP-23. There are eleven, one for every iPhone screen on a current iOS: SE 2nd/3rd gen, XR/11, XS/11 Pro/12–13 mini, XS Max/11 Pro Max, 12–14 and 16e, 12–13 Pro Max/14 Plus, 14 Pro–16, 14 Pro Max–16 Plus, 16 Pro/17/17 Pro, Air, and 16–17 Pro Max. They are palette PNGs, about 99 KB for all eleven, and an iPhone fetches only its own. iPads are left out because they need both orientations and many sizes.
- **Sheets close with ✕, "Got it" or a tap outside.** Dragging one down was not trivial with the Radix sheet and is PW4's.
- **The app-like basics land here**, not in PW-3: no tap highlight, `touch-action: manipulation` on controls, no selection or link callout on buttons and tabs, `100dvh` for `100vh`, and the keyboard helper. Back controls stay PW-3's.

### PW1 — back, everywhere (PW-3)

- **One control: a chevron.** `BackButton` (`components/kitchen/back-ui.tsx`)
  is lucide's `ChevronLeft` at 24 px in a 44 px round target. It sits
  top-left in the header, pulled 10 px left so the glyph lines up with the
  content edge, in the muted colour. SM-15 had found a mix: an arrow on Use,
  a group, Settings, Add a bill and a person, and a chevron elsewhere. The
  chevron matches iOS and Android's newer style.
- **No word beside it.** The item page's "‹ Pantry" lost its word, and every
  control is labelled "Back" for screen readers (it was "Back to People",
  "Back to Flat 4B"…). When the app has history, Back returns where you came
  from, which is not always the parent, so a named label would be wrong. The
  screen's own title says where you are.
- **Where it is.** Use, Cook, Bought, You (phone only: from 900 px You is
  the sidebar's "Me", a destination like the tabs), an item, a dish, a group,
  the group's Settings and Add a bill, a person, and the join page, which had
  no back control before. `/settle` shows no screen (it replaces itself with
  People), but it still has a parent in the map. The + Add sheet's "Which
  group?" step uses the same chevron (`BackControl`) with its own action.
  - Loading, not-found and error states are unchanged and have no back
    control. Not-found states keep their own way out ("Your groups",
    "People"), and the tab bar is on every screen.
- **The parent map** is one pure function, `backParent` (`components/kitchen/back.ts`),
  keyed by SM-2's page patterns. It is tested to cover every page in
  `STATIC_PAGES`: a tab, a screen with a parent, or outside the app
  (`/`, `/login`, `/auth/callback`). A new page with no parent fails the
  test.
  - An item goes back to its own pantry, `/pantry?pantry=personal|org_…`,
    read from the address, as the old link did.
  - A dish goes to its group once the dish and the group list are read;
    before that, and for a dish of your own, it goes Home. The old link sent
    a shared dish whose group was unknown to Groups; the brief's map says
    Home.
  - Bought goes Home (the old link went to Pantry), per the map. With
    history it goes back, so to Pantry when it was opened from Pantry.
- **"Has history" is an exact count, not a navigation counter.** A counter
  of navigations breaks this case: a notification opens a dish, Back
  replaces it with the group, and a second Back would then call
  `history.back()` and leave the app. A `history.length` heuristic cannot
  tell a push made after going back from a replace: Home → a dish → back →
  an item → Back would land on Pantry instead of Home. So the trail
  (`createTrail`) counts the app's own screens behind the current one.
  - It wraps `history.pushState` and `replaceState` once, as Next itself
    does, and passes every call through. While the kitchen frame is up, a
    push adds one, a replace (Back's own included) keeps the count, and
    the entry written carries the count as `cookpoolBack` beside Next's
    state.
  - A back or forward (`popstate`, read in the capture phase, before Next
    restores the screen) or a reload reads the count back from the entry.
  - The frame starts again from 0 whenever it mounts: opened from outside,
    or back from sign-in. Entries written outside it carry no count. A
    missing count is 0, and 0 means the parent. The count may be too low
    but never too high, so Back never leaves the app.
- **Browser check** (the production build under `wrangler dev`, behind the
  SM-2 proxy with SM-11's mock, headless Chrome at 390×844).
  - Direct opens: each of the twelve non-tab screens was opened straight in
    a fresh tab, after `about:blank` as if from another site. Back landed on
    its parent with `history.length` unchanged (a replace, still in the app).
    A dish, Settings and Add a bill were followed with a second Back from
    the group, which landed on Groups.
  - Navigating in, Back returned where you were:
    - Home → Pantry → an item: back to Pantry.
    - Home → a dish: back to Home, not the dish's group.
    - Home → + Add → Used: back to Home.
    - Groups → Flat 4B → Settings: back to Flat 4B, then Groups.
    - People → a person: back to People.
    - Home → a dish → the browser's back → a dish: back to Home (a push
      after going back still counts).
    - Pantry → an item → reload: the count was kept (2), and Back went to
      Pantry.
  - The item, a group, Cook and a dish put the control at the same box
    (x 6–50, y 20–64).
- **For PW-6 and PW4.** A You → Notifications page needs `BackButton` and a
  `PARENTS` entry (`/you/…` → `/you`), or the coverage test fails once the
  page is in `STATIC_PAGES`. The iPhone back gesture (PW4) should use the
  same rule through `useBack()`, which BackButton uses.

### PW2 — no signal, clean updates (PW-4)

- **Our own worker, built per deploy.** `scripts/service-worker.mjs` runs
  after `pages-as-files` and writes `.open-next/assets/sw.js`: the worker's
  modules (`src/service-worker/*.mjs`, plus SM-2's page table) bundled into
  one classic script, with this build's id and precache list — the 17 pages
  served as files at their own addresses (`/home`, `/dishes/_`, …; not the
  OAuth return), their `/_rsc/*.rsc` payloads, every `/_next/static/**` file
  and the icons (174 files, 3.2 MB on this build). Caches are
  `cookpool-static-<build id>`. A page or payload that does not name the
  build id fails the build and, at install, fails the install (a second
  deploy landed while it downloaded: the browser retries). A hashed file an
  earlier build's cache already has is copied, not downloaded again.
  `public/_headers` serves `/sw.js` with `Cache-Control: no-cache`; no
  `_redirects` rule or `run_worker_first` path takes it (tested).
- **Not the manifest.** The brief listed "the icons and the manifest" for the
  precache and "the manifest route" as network-only. The manifest is the
  Worker's route, rendered per deploy (runtime product name), so it stays
  network-only, as design §3 lists the precache.
- **The fetch rules are one pure function** (`classify`, routes.mjs), tested
  as a table: page loads and payloads network-first with a 3 s cutoff, then
  this build's copy (a dynamic page falls back to its `_` file); hashed
  files and icons cache-first; the listed API reads network-first into the
  account's cache; everything else network-only and never cached (any
  write, `/api/v1/auth/**`, join codes and previews, typed searches,
  `/auth/callback`, the manifest, the admin console's pages, other origins).
  Navigation preload is on, so a network-first page load does not wait for
  the worker to start.
- **The API reads kept** (after `/api`): `/v1/organizations`;
  `/v1/kitchen/me/` `inbox`, `usuals`, `pantries`, `items`, `items/:id`,
  `items/:id/moves`, `dishes/:id`, `balances`, `people/:subjectId`;
  `/v1/organizations/:org/kitchen/` `items/:id`, `items/:id/moves`,
  `dishes`, `members`, `settings`, `balances`, `settle-plan`, `activity`.
- **API reads have no cutoff.** They answer from the cache only when the
  network fails. A cutoff would let an answer stored before a write replace
  what SM-5 patched on screen on a slow connection.
- **"You" is not cached offline.** The profile (`/api/v1/auth/profile`) is
  under `/api/v1/auth/**`, which the brief keeps network-only. So offline
  screens show the last data without the person's own name and "you" parts:
  Home says "Good evening" with no name, and a dish shows no claim controls.
  Caching just the profile in the account's cache would restore them; that
  is a decision for the owner.
- **Per account, bound to the session.** The page sends the subject id and a
  SHA-256 of the session's token (`cookpool:account`) after sign-in and on
  every load. The page takes the subject id from the profile read every
  signed-in page makes anyway, so this adds no request. The worker keeps that one
  record (`cookpool-meta`, a hash, never a token). It answers from, or
  stores into, `cookpool-data-v1-<subject id>` only for requests that carry
  that very token. A request with any other token goes to the network and is
  never stored: another account in another tab, or a session from before. Telling it about another account
  deletes every other account's data. Signing out deletes all of it. So does
  a 401 that ends the session, or a page that loads with no session: the
  session's `setToken(null)` and the page itself both delete it. Entries are
  keyed by address alone, so no request header is stored. An answer still on
  its way at sign-out is not kept. Each account's cache is capped at 300
  answers.
- **Offline, as the page sees it** (`lib/connection.ts`): the browser says so,
  or the last API call failed for network reasons. An answer the worker gave
  from its cache counts as a failure; it carries `x-cookpool-cached-at`, which
  is where the banner's "as of 7:42 pm" comes from (the oldest shown). The
  banner sits in the root layout, so every page has it (canvas colours). It
  goes when an answer comes from the network, and then every read is
  refreshed. While offline the page retries on `online`, on return to the
  app, and every 30 s. React Query reads use `networkMode: "offlineFirst"`.
  Without it, a read started after the browser's `offline` event would never
  ask the worker.
- **Writes held back at three layers, so no write path is missed.**
  - `beginWrite` applies no patch and returns a handle that does nothing.
  - The Undo toast offers nothing, and an Undo pressed offline is held back.
  - The API client itself refuses every non-GET except sign-out, before
    anything is sent. This covers cook, settings, join, sign-in and every
    other path; the refusal comes back as `network_error`, `reason: "offline"`.
  The one-line toast is "You're offline · nothing was logged". A screen's own
  refusal toast that only repeats those words is shown as that one toast, once.
  A claim tap is held back before its burst shows the new count
  (`usePortions.set`). Nothing is queued.
- **Updates.** A new build installs and waits. If the open page already is
  that build, the new worker takes over silently, with no offer and no
  reload. That is the usual case after a deploy, because pages are
  network-first. The page sends its build id, read from its own flight data,
  and the worker compares it with its own. Script tags were not enough: the
  browser check showed that a changed layout chunk is loaded on demand and is
  not among them. If the page cannot read its build id, nothing is adopted and
  the offer shows. Otherwise the shared toast offers
  "New version · Reload". It waits while SM-5 counts a write on its way, while
  an Undo toast is up (the canvas), while offline, and on the sign-in pages
  (all of `/login` and `/auth/callback`, not only mid-code). Closing it
  hides it until the app comes back. Reload: `skipWaiting`, then
  `controllerchange`, then one reload (or a reload after 4 s if the swap never
  comes). On return to the foreground the page checks for a new build. Away
  (hidden) more than 24 h with one waiting, it reloads itself.
- **Kill switch.** Set `src/service-worker/switch.mjs` to `"off"` and the
  build writes a worker that takes over at once, deletes every `cookpool-*`
  cache, unregisters and reloads its pages from the network. Pages of that
  build unregister instead of registering (`docs/runbook.md`).
- **Registration** is only in production builds, after `load`, from
  `ServiceWorker` in the root layout. `next dev` unregisters a leftover
  worker on its origin. A failure leaves the app as it was.
- **Browser check** (the production build under `wrangler dev`, the SM-7 UX
  mock answering `/api` on the page's own origin from Node, so API calls
  really go through the worker; headless Chrome 156 on
  `cookpool-web-console-next-stage.localhost`, 390×844). The app's browser
  pane cannot register a service worker at all ("An unknown error occurred
  when fetching the script", on any host), and Claude in Chrome was not
  reachable.
  - Online: `/sw.js` came with `cache-control: no-cache`, `/_next/static/*`
    with `immutable`, and `/_headers` was not served. The worker installed
    174 files and took over. After Home, Pantry and a dish, the account's
    cache held the listed reads, keyed by address; the record held the
    subject id and a hash.
  - Both servers stopped, then a reload: Home, Pantry (by its tab and by
    address) and `/dishes/dsh_…2` opened from the worker, with the last data
    and the banner "Offline · showing what you saw last · as of 2:19 am".
    Logging 1 pc of Eggs showed the one toast "You're offline · nothing was
    logged", with no Undo. No write request left the page, and Pantry still
    read "7 of 12 pcs". With the servers back, the banner went at the next
    retry and the screen refreshed.
  - Updates, round 1: a rebuild with a visible change (the People tab
    renamed, then reverted) was adopted silently. The adoption then compared
    the page's scripts, and the changed layout chunk is loaded on demand.
    That check was replaced by the build id.
  - Updates, round 2: a page of the new build loaded while the old worker
    was in charge was adopted silently, as it should be. Then a page of that
    build was brought back to the foreground after the next deploy. The new
    worker installed and waited, the page showed "New version · Reload",
    and Reload made one reload into the new build (the tab read "People"
    again). The old cache was deleted and the account's data was kept.
  - A first visit (worker and caches cleared) recorded the account without
    a reload; the browser check is what found that bug (fixed with
    `serviceWorker.ready`).
  - "Sign out of this phone" sent the logout and left only the build's own
    cache: the record and the data were gone.
- **Not done here (page code, other tasks):** Add item and Add expense still
  navigate at once (SM-5), so offline the form is left and the toast says
  nothing was logged. Keeping the form when `isOffline()` is a line for the
  + Add rebuild (SM-10) and the expense page.

### PW3 — push, in the server (PW-5)

- **Push rides on the email's enqueue.** kitchen-worker asks for nothing new:
  when notifications-worker creates a notification of one of the three kinds
  (sent, or suppressed for email), it pushes to the recipient's devices after
  the email path, in the same request (kitchen-worker already runs it after
  its response, `ctx.defer`). An idempotent hit pushes nothing, so a retried
  enqueue never pushes twice; a push that fails never touches the email.
- **"A dish to claim" is `kitchen.dish_posted`.** The three kinds are
  `kitchen.portion_set`, `kitchen.dish_posted` and the new `kitchen.paid_you`
  (`NOTIFICATION_KINDS`). Push bodies: "Anu said you had 1 portion of Egg
  fried rice", "Egg fried rice is ready to claim", "Dev paid you ₹400.00 ·
  UPI" (amounts as every email formats them, with paise). Title "Cookpool";
  `url` the path the email links to (`/dishes/dsh_…`, `/people/usr_…` for a
  payment); `tag` the enqueue's idempotency key (what and for whom).
- **Push preferences are the person's own, in every group.** Same table and
  route as email preferences (no second model): a `channel: "push"` row
  under the system organization, with a new `kinds` map; `orgId` is left
  out. Push is opt-in per kind (only `true` sends); email stays per group,
  opt-out. `kinds` merge key by key on PUT (`null` clears one); categories
  still replace. `kinds` also work on email rows (an explicit `false` stops
  that kind's email); nothing sets them yet.
- **Two migrations, not one.** `310_notification_push_subscriptions` adds
  `notifications_push_subscriptions` (design §4 said `notification_subscriptions`;
  named for its context). It has no `org_id`, unlike every other
  notifications table: push reaches a person from every group.
  `320_notification_push_preferences` rebuilds the preferences table, because
  SQLite cannot change its `channel IN ('email')` check in place. It keeps the
  name, every row (kinds `{}`), the unique key and the org index, so the worker
  from before it keeps working. A failure between its DROP and its RENAME
  needs one statement run by hand (the worker's runbook).
- **Subscriptions.** Upserted by endpoint: a device that changes hands moves,
  starting afresh. At most ten a person, dropping the least recently
  subscribed. Validation: an `https:` endpoint with no credentials, up to
  2048 characters; `p256dh` a real P-256 point, `auth` 16 bytes. There is no
  push-service host allow-list. The label comes from the User-Agent the edge
  forwards ("Chrome on Android"). DELETE answers 200 `{ removed }`:
  `removed: false` for a device that is not yours, never a 404.
- **Sending.** WebCrypto only: RFC 8291 `aes128gcm`, reproducing Appendix A
  byte for byte (tested); VAPID as an ES256 JWT, 12 h, `aud` the push
  service's origin, `sub` `mailto:` EMAIL_FROM_ADDRESS, one token per origin
  per fan-out. Each push has `TTL: 86400` and `Urgency: normal`, with a 10 s
  timeout and no `Topic`.
  - 2xx records `last_success_at`.
  - 404 or 410 deletes the subscription.
  - Anything else records `last_failure_at` and a bounded reason
    (`push_service_429`). It is not retried, and it logs one line with counts.
- **Keys.** `VAPID_PUBLIC_KEY` is a var per environment: an empty placeholder
  with a `TODO(PW-5 keys)` in the template. `VAPID_PRIVATE_KEY` is an optional
  runtime secret (`optionalSecretEnv` + `runtimeSecrets`), base64url PKCS#8.
  The script is `apps/notifications-worker/scripts/vapid-keys.mjs`, not
  `tooling/push/` (outside the contract); it prints to stdout only. Fail
  closed: a missing or malformed key, or a private key that does not sign for
  the public one, turns push off. `push-key` then answers `publicKey: null`
  and one log line per isolate names the cause. Email is unaffected.
- **Added: `POST /v1/notifications/push-test`.** It powers the canvas's "Send
  me a test": a push to the caller's own devices, or to the one named. It
  answers `{ devices, sent, gone, failed }`, or 503 `unsupported` while push
  is off.
- **Someone paid you.** POST …/kitchen/settlements, once committed, enqueues
  `kitchen.paid_you` to the payee (`kitchen.paid_you:<txn>:<usr>`), whether
  the payer or an owner or admin recorded it, but never when the payee did.
  The email follows `kitchen.portion_set`'s style: "Dev paid you ₹400.00 ·
  UPI". The method reads UPI, Cash or Bank transfer; "other" says nothing.
  The link is the payer's page.

### PW3 — notifications, in the app (PW-6)

- **A switch is on for THIS device.** It shows on when the person has that
  kind on (the server's `kinds`, the same on every device) and this device
  has a push subscription with permission. A kind turned on from another
  phone shows off here until this phone subscribes too; turning one on here
  then also shows the kinds the person already had on. A new device starts
  with everything off, as the canvas draws it.
- **The ask comes only from turning a kind on.** `Notification.requestPermission()`
  is the flow's first await, so it is still inside the tap, as Safari
  requires. Denied (now or before): the switch goes back, with "Notifications
  are blocked in your browser settings". A closed prompt goes back quietly.
  Already granted: no prompt. Then this device subscribes with the server's
  key (a subscription made with another key is replaced), `subscribePush`,
  then `setPushKinds({ kind: true })`. Off is `setPushKinds({ kind: false })`
  alone: the subscription stays, even when the last kind goes off.
- **Optimistic, but not through `beginWrite`.** The switch moves at once and
  goes back exactly as it was when the phone or the server says no (a
  failure also gets a toast). The write is counted (`trackWrite`), so the
  update offer waits for it, and offline it is held back
  (`refuseIfOffline`). What a switch shows depends on the device as well as
  the read, so the flip is the page's own state until the server answers;
  then the server's row replaces the read.
- **A subscribe that never finishes fails after 20 s** (and a service worker
  that is not ready, after 10 s). The browser check found headless Chrome's
  `pushManager.subscribe` never settles; a phone whose push service is
  blocked would otherwise leave the switch spinning.
- **Where push can't work** (`notifyDevice`, `pushView` in `lib/push.ts`,
  tested):
  - iPhone or iPad, not installed: one card, "Add Cookpool to your Home
    Screen to get notifications", and How opens PW-2's sheet. The badge
    switch goes too: iOS badges only the installed app.
  - An app's own web view on iOS (Instagram) cannot install, and no
    PushManager anywhere: "This browser can't show notifications from
    Cookpool."
  - `publicKey: null`, and also a build without the service worker (`next
    dev`, or the kill switch off): the three switches are hidden and one
    quiet line says "Notifications aren't available yet."
  - The badge switch still shows in each of these where the browser can
    badge.
- **The badge switch shows only where `navigator.setAppBadge` exists.** That
  is desktop Chrome and Edge and the installed iPhone app, but not, today,
  Chrome on Android, whose icon shows a dot for unread notifications by
  itself. The canvas's Android variant draws four switches; a phone without
  the API shows three. The switch is per device (localStorage
  `<prefix>.badge`), off until turned on. WebKit shows an icon badge only
  with notification permission, so on an iPhone (and Safari) turning the
  badge on asks too, after the choice like the kinds.
- **The badge follows Home's inbox read.** `AppNotify`, in the kitchen
  layout, reads `qk.kitchenInbox()` while the switch is on. It shares Home's
  read, so an optimistic write moves the count too. It sets Home's to-do
  total (the "See all N"), clears it at zero, and clears it when the switch
  is off. With the switch on, every kitchen page reads the inbox (cached).
  The row's example draws the "3" as a small badge, not plain text.
- **The worker's push handler** (`src/service-worker/push.mjs`, bundled
  before runtime.mjs) calls `showNotification(title, { body, tag, icon:
  "/icons/icon-192.png", badge: "/icons/badge-96.png", renotify: false,
  data: { url } })`.
  - A missing or unreadable payload, or a title with no body, shows
    "Cookpool · Something new for you" and opens Home.
  - If the platform refuses the options, a plain notification still shows.
  - `url` must be a path in the app; anything else opens `/home`.
  - The badge icon is new: `public/icons/badge-96.png`, the pot in white on
    transparent, drawn by `scripts/gen-icons.mjs` (every other icon is
    byte-identical).
- **A tap** focuses the Cookpool window the worker controls (the focused
  one, else a visible one, else any) and navigates it to the push's page
  unless it is already there. With no window, or one that cannot be moved,
  it opens a new one.
- **`pushsubscriptionchange` re-subscribes in the worker, but the page
  re-posts.** The worker holds no token (PW-4). So it re-makes the
  subscription with the old key and tells its pages
  (`cookpool:push-renewed`), and a signed-in page posts it. Every signed-in
  launch (a full page load) also re-posts this device's subscription when
  it has one with permission, as the SDK suggests (`subscribePush` is an
  upsert). A renewal with no page open therefore reaches the server at the
  next launch.
- **Signing out removes this device.** `DELETE …/push-subscriptions` and the
  browser's `unsubscribe()` run together, before logout. The wait is capped
  at 2.5 s, and a failure never stops sign-out. Offline, only the browser
  unsubscribes. The badge switch and the badge are cleared too
  (`clearDeviceRecords`).
- **No session left, no subscription left.** A 401 that ends the session, a
  sign-out from the admin console and any page loaded with no session
  (`setToken(null)` and the worker's signed-out path) unsubscribe in the
  browser only. The server cannot be told without a session, and
  notifications-worker deletes the dead endpoint at its next push (410).
  Signing in as someone else on that phone starts with nothing subscribed.
- **"Send me a test"** shows once one of the three kinds is on for this
  device (not for the badge alone). It sends `sendTestPush(endpoint)` and
  says "Sent · it arrives in a moment", or "Couldn't send a test" when
  nothing was sent.
- **The header's back control is a plain link to You.** PW-3's shared
  `BackButton` and the `/you/notifications` → `/you` parent entry come when
  PW-3 is merged in. `/you/notifications` is a static page like the others
  (20 pages served as files, 191 files precached).
- **Browser check.** The production build ran under `wrangler dev` with a
  copy of the SM-11 mock answering `/api` in Node. The copy adds the push
  routes, with a throwaway P-256 key, or `null`. Headless Chrome, 390×844,
  on `cookpool-web-console-next-stage.localhost`. Headless Chrome cannot
  finish a real subscribe, so a fake `PushManager` in the page kept the
  subscription; the worker's pushes were real (CDP).
  - The four variants: Android, the installed iPhone, the iPhone in Safari
    (How opens the two steps) and `publicKey: null`.
  - Denied (CDP `Browser.setPermission`): the switch went back with the
    line, and no request was sent.
  - Granted (`Browser.grantPermissions`): the switch showed on at once, then
    `POST push-subscriptions` and `PUT preferences`, and "Send me a test"
    appeared. The test sent `POST push-test`, and its toast showed.
  - The badge switch set the icon to 14, Home's "See all 14".
  - `ServiceWorker.deliverPushMessage` with the portion payload showed
    "Cookpool · Anu said you had 1 portion of Egg fried rice", with its tag,
    `/dishes/dsh_…2`, the icon, the badge and `renotify: false`. An empty
    push showed the generic one.
  - A tap cannot be made headless: Chrome has no CDP command for it, and an
    event dispatched in the worker carries no user activation, so Chrome
    refused `focus()` and `openWindow()` there. The fakes and the bundled
    worker's test cover the tap.
  - Sign-out sent `DELETE push-subscriptions`, then `POST /v1/auth/logout`.
    The browser unsubscribed, and the badge and its switch were cleared.
    Signed in again, every switch was off, though the person's kind was
    still on at the server.
  - A 401 that ended the session unsubscribed the browser before `/login`.

### PW4 — gestures: pull, edge, sheets (PW-7)

- **Touch events, not pointer events.** A pull at the top of the page, or a
  sheet's list at its top, starts where the browser would scroll, so the
  gesture must stop the browser at the first move. Only a `touchmove` can be
  cancelled: once the browser pans, pointer events end in `pointercancel`,
  and `touch-action` cannot change mid-gesture. So one small listener
  (`listenForDrags`, `lib/gestures.ts`) follows one finger. `touchmove` is
  not passive, and it cancels only the moves of a drag the gesture takes, or
  is about to take while it decides (the first 8 px). Everything moves with
  CSS transforms; there is no gesture or animation library. Mouse and pen
  are left alone: these are phone gestures, and each has its twin.
- **One rule per gesture, tested as data.** Whose drag it is (`pullRule`,
  `edgeSwipeRule`, `sheetDragRule`), the numbers, which screens pull
  (`PULL_PAGES`) and where the edge swipe is on (`edgeSwipeBackOn`) are
  pure. Every page in `STATIC_PAGES` either pulls or is listed as not
  pulling, so a new page has to choose. Anything marked
  `data-gestures="off"` keeps its drags from all three, as text fields do.
- **Pull to refresh** (`PullToRefresh`, in the kitchen layout's `<main>`) on
  Home, Pantry, Groups, a group, People, a person and a dish. It is not on
  Use, Bought, Cook, Add a bill or Settings (forms), and not on You, an item,
  a join link or `/settle`.
  - It starts only when the page is at its very top, and so is any list the
    finger is on. The drag must go down, more down than sideways.
  - The screen follows at half the finger's speed, up to 96 px, with a
    turning arrow in the gap. Let go from 64 px (a 128 px drag) and the
    screen's active queries are read again (`refetchQueries({ type: "active" })`,
    the reads it already uses, after SM-5's writes in flight). The arrow
    spins at 56 px until they settle, and for at least 0.6 s. Short of 64 px,
    it springs back.
  - There is no "Up to date" toast, which the canvas showed. The spinner
    going away is the answer, and the one toast slot belongs to Undo.
  - Offline, the gap shows "Offline · showing what you saw last" for 1.8 s
    instead of the spinner. The network is still tried quietly, as the
    offline banner's own retry does.
  - **In a browser tab too.** PW-2 left the browser's own pull-to-refresh to
    browser tabs. On the pull screens ours now replaces it there as well (it
    cancels the moves). There is one refresh, the same everywhere, and it is
    not a full reload.
- **The pull's twin was not there.** Design §5 says data "refreshes on
  focus as today", but the app's QueryClient had `refetchOnWindowFocus:
  false` (cookpool-kitchen's "no refetch on focus"). It is now `true`
  (`app/providers.tsx`). Coming back to the app reads the screen's reads
  again when they are over a minute old (the `staleTime`), in the
  background, with no spinner. Within a minute nothing is read. Reverting
  it is one line, if the owner prefers fewer reads.
- **Swipe from the left edge** (`EdgeSwipeBack`) works only when the app is
  installed (`display-mode` or `navigator.standalone`) on iOS, and never on
  a tab.
  - It runs on iPads too (`isIos`, including an iPad asking for desktop
    sites). An installed iPad app has no back gesture either; design §5
    names the iPhone.
  - A drag that starts within 20 px of the left edge and goes right takes
    `<main>` with the finger, with a soft shadow. The tab bar stays.
  - Let go past 30% of the width, or flick (0.5 px/ms over at least
    24 px), and the page slides away in 200 ms, then Back runs. Short of
    that, it springs back.
  - **Back is the back control's own action.** `BackButton` tells the frame
    what it does (`shownBackAction`), so a dish goes to its group once the
    group is known, as the chevron does. While a screen shows no control
    (loading), the swipe uses `useBack()` with the address alone.
  - The page is put back when the new screen's address arrives, or after
    1.5 s if none does.
  - A drag that turns vertical scrolls. One that starts elsewhere is not
    captured. A row that scrolls sideways (the usuals, chips, Use's
    recents) keeps its drags even at the edge, as do text fields. Sheets
    and dialogs sit outside the frame, so an open one is never swiped
    behind.
  - **Reduced motion:** the page does not follow or slide. A chevron fades
    in at the edge as the finger goes, and Back runs on release.
- **Every bottom sheet drags down to close**, in the shared `SheetContent`
  (`side="bottom"`, `components/ui/sheet-drag.ts`). That covers + Add and its
  "Which group?" step, Groups' "Add a group", the measure question, the iPhone
  install steps, Cook's ingredient picker, and PW-8's long-press menu if it
  uses the same sheet. Side sheets and centred dialogs do not drag.
  - A drag down that starts on the handle or the header moves the sheet,
    and so does one on a list that is at its top (the sheet itself, where
    it scrolls). A list scrolled down keeps scrolling, and sideways chip
    rows keep their drags.
  - The sheet follows the finger and the scrim lightens with it. Past
    80 px, or on a flick, it closes; short of that, it springs back.
  - **It closes by pressing the sheet's own ✕**, so every owner's
    `onOpenChange` runs exactly as for ✕. If an owner keeps it open, it
    springs back after 0.4 s.
  - The finger moves the CSS `translate` property, not `transform`.
    Radix's slide-out animates `transform`, so the sheet carries on down
    from where the finger left it instead of jumping back first. The scrim
    lightens by its colour, because Radix fades it out by opacity.
  - **Reduced motion:** the sheet still follows the finger. The global rule
    makes the spring and the slide-out instant.
- **Reduced motion, the pull:** the screen still follows the finger (96 px
  at most). The arrow does not spin, because the global rule stops
  animations, and screen readers hear "Refreshing".
- **The kitchen frame clips sideways overflow** (`overflow-x-clip` on the
  layout's root). Without it, `<main>` sliding away made the page wider than
  the phone. The browser check showed the mobile viewport growing and the
  tab bar pushed off the bottom mid-swipe. `clip` does not make a scroll
  container, so the page still scrolls and the sidebar stays sticky. Fixed
  parts (the tab bar) are not clipped.
- **Browser check** (the production build under `wrangler dev`, behind the
  SM-2 proxy with SM-11's mock, headless Chrome at 390×844). Touches went
  through Chrome's real input pipeline with CDP `Input.dispatchTouchEvent`,
  so scrolling, taps and cancelled moves were Chrome's own. All 36 checks
  passed.
  - **Pull, 13 of 13.**
    - Home: a 90 px drag (45 px) sprang back with no read. A 180 px drag
      held the spinner at 56 px ("Refreshing"), read Home's 16 active reads
      again, then let go.
    - Scrolled down 300 px, the same drag scrolled the page and pulled
      nothing. A sideways drag on the usuals row scrolled the row.
    - Offline (CDP), the gap read "Offline · showing what you saw last".
    - Use pulled nothing. Pantry, Groups, Flat 4B, People, Dev and a dish
      each read their screen again.
    - The twin: a `visibilitychange` within a minute read nothing; after
      62 s it read Pantry's 6 reads.
  - **Edge swipe, 12 of 12.**
    - Headless Chrome as it is, and iPhone Safari not installed: nothing.
    - Faked as the installed iPhone (its user agent and
      `navigator.standalone`), Groups → Flat 4B → swipe went back to Groups.
      `<main>` followed the finger (147 px, then 294 px), with the page
      still 390 px wide and the tab bar in place. On Groups (a tab) the
      swipe did nothing.
    - A slow 74 px swipe sprang back. A vertical drag from the edge
      scrolled. A swipe from 40 px in was not captured. An 84 px flick went
      back.
    - A dish opened straight from outside went to its group, as the
      chevron does.
    - On Use, the recents row kept a swipe from the edge, and the same
      swipe below it went Home.
    - With reduced motion, the page stayed put, the chevron showed, and
      Back ran.
  - **Sheets, 10 of 10.**
    - + Add: closed by a drag of the handle (160 px) and by a drag from a
      tile, which opened nothing. A 60 px flick closed it; a slow 40 px
      nudge sprang back. ✕ and a tap outside still closed it.
    - + Add at 390×300, where the tiles scroll: scrolled, a drag down
      scrolled them back and the sheet stayed; at the top, it closed.
    - Cook's picker (its list is 932 px in 570 px): it scrolled to 362 px,
      and a drag down scrolled it back to 213 px with the sheet still open.
      The handle closed it while the list was scrolled. At the list's top,
      a drag on the list closed it.
    - The iPhone install sheet closed when dragged by its title. With
      reduced motion, + Add closed at once.
  - With a sheet open, headless Chrome delivers a touch move every 33–50 ms,
    against about 16 ms on a phone. So the flick checks use 60–84 px; the
    unit tests cover the speed rule itself.
- **For PW-8.** A long-press menu built on `SheetContent side="bottom"`
  drags away with no extra code. Row swipes go left, so they never meet
  the edge swipe (right, from the edge) or the pull (down). A row can opt
  out of all three with `data-gestures="off"`.
- **Not done here.** Mouse and pen drags, the item page and You (no pull,
  per the brief's list), and real phones. The owner's checklist is in the
  PR.

### PW4 — gestures: rows, long-press, hold (PW-8)

- **Small trackers, no library.** `src/lib/row-gestures.ts` holds the rules
  and two trackers (pointer-like events in, decisions out, time from an
  injected clock): `RowGestureTracker` (a row's swipe and press, one at a
  time) and `HoldRepeatTracker`. `components/kitchen/row-gestures-ui.tsx`
  forwards React pointer events to them: `SwipeRow` moves its front layer
  with a CSS transform written straight to the element (no render per move),
  and `RepeatButton` is the stepper's − or +. The numbers:
  - **Swipe:** nothing is decided inside 10 px. A drag mostly to the left
    (|dx| > |dy|) is the row's; mostly vertical is the list's scroll (the
    row is `touch-action: pan-y`, so the browser still scrolls it); to the
    right is not ours (PW-7's edge swipe back). The row follows the finger,
    never right and never past its width. Let go past 40 % of the row's
    width, or with a flick (≥ 0.6 px/ms over the last 100 ms, at least
    48 px), and the action runs; otherwise it springs back (180 ms).
  - **Press:** held 450 ms within 10 px opens the menu. Android's own
    long-press (`contextmenu`) on such a row opens ours at once instead, and
    is prevented; iOS's callout, text selection and link dragging are off on
    swipe rows (CSS). After a swipe or a press, the click the browser sends
    on release is swallowed for 400 ms (and while the menu is held), so the
    row's link never opens as well. Neither the swipe nor the press answers a
    mouse: the buttons are a mouse's way.
  - **Hold:** a tap is still the button's own click (keyboards and screen
    readers are unchanged). Held 400 ms, it steps every 150 ms, every 60 ms
    from 1 s, until release, leaving the button (12 px of slack; a captured
    touch is checked on move), the browser taking the touch, or the end. The
    click that ends a hold that stepped is swallowed, however long the
    finger stayed at the end. Each step calls the same `onStep` a tap does,
    so the dish page's claims keep SM-5's burst: one PUT and one toast.
  - **`prefers-reduced-motion`:** no spring and no fade; the row still
    follows the finger (it is the person's own movement) and is back at once.
  - **Android:** `navigator.vibrate(10)` at a completed swipe, where it
    exists. Nothing depends on it.
- **Swipe a pantry row left** (Pantry's phone list; Home's use-soon to-dos):
  it runs the row's own Use — `useLogUse` with the same arguments, so the
  same write, Undo toast, offline refusal and refusal words. It reveals the
  button's words: "Use 1 glass" (`swipeUseLabel`). A row whose Use opens Use
  reveals "Use" and opens `/use?item=…` (no write). A viewer's row, one with
  nothing left and a pending row don't swipe. **Home's row runs its button,
  which may not be a usual:** the use-soon card's one tap is its default
  amount ("100 g" for a weighed item without a usual, SM-14), and the brief
  says the swipe fires exactly the button. Its rare "Open" to-do (no amount
  fits) reveals "Use" and opens Use. The button and the swipe share one hook
  (`useSoonUse`), so they cannot drift.
- **Swipe your own log left → Undo.**
  - **Activity:** `ActivityRow.canSwipeUndo` (`swipeUndoable`). It needs the
    row's ⋮ to offer Undo, the entry to be yours (`createdBy`), and its kind
    to be a use or a waste (`SWIPE_UNDO_KINDS`). Never a bill, a payment
    (even one you recorded) or a dish, never a reversal, and never someone
    else's entry, even for an owner or admin whose ⋮ offers Undo: those stay
    behind ⋮. **Bills are out** (reviewer's call): undoing a bill reverses it
    for the whole group, which is a delete, and deletes stay buttons (README
    decision 3). The swipe calls the menu's own `undo`, with its toasts.
  - **An item's history:** `canSwipeUndoMove` is `canUndoMove` and you
    logged it. A dish's take, a transfer and an admin's undo of someone
    else's use keep their button alone. The swipe calls the row's `undo`,
    with its toast ("Undone · It's back in the pantry."). The history card
    clips its rows now (`overflow-hidden`), so a moving row stays inside its
    rounded corners.
  - The reveal is dark with the undo arrow; a use's is green with a tick.
    The focused activity row (`?txn=`) keeps its tint, drawn opaque so the
    reveal doesn't show through.
- **Press and hold an item** (Pantry rows, Home's use-soon rows) opens
  `ItemActionsSheet` on the shared bottom sheet, unchanged (PW-7's drag-down
  will close it like any sheet). It lists Use [your usual] · Use some… ·
  Cook with it · Wasted · Open (`itemActions`), as the canvas draws it.
  - "Use 2 pcs" shows only when the row's button logs a usual, and runs the
    same write.
  - **Wasted turns the sheet into the item page's confirm.** It is the same
    component, now shared (`WasteConfirm`): "Throw away the 7 pcs left
    (₹49.00)?", who pays, Keep it · Mark wasted, then `useWasteItem` with
    its Undo toast. The item page looks as it did.
  - A viewer's item, one used up or wasted, or one not read yet offers Open
    alone.
- **Every stepper repeats while held:** the dish page's portions
  (`PortionStepper`); Cook's amount, count, extras, portions and who-ate
  steppers; Use's Another amount; a bill's shares.
  - **A held − on a Cook ingredient stops at its smallest amount**
    (`LineView.atSmallest`, `canRepeat={false}`). The next tap still takes
    the ingredient out, but a hold never does.
  - **Use's Another amount − and + are disabled at their ends** (they did
    nothing there before), so a hold stops there.
- **Not built, on purpose:** the canvas's hint card ("Swipe left to use your
  usual · hold for more"). It is not in the brief, and every gesture has its
  visible twin; it is one small component if the owner wants it. From
  900 px the Pantry is the table, with no swipe; Home's to-do rows answer
  touch at any width.
- **Tests** (tests/web-console-next):
  - `row-gestures.test.ts` (new, 28): the intent rule, the offset, the 40 %
    threshold and the flick, the speed window. The row tracker, driven by
    synthetic touch events and a fake clock: a long swipe fires once and
    swallows its click; a short one springs back; a flick fires; a vertical
    or rightward drag does nothing; a cancel springs back; a mouse and a
    second finger are ignored. The press at 449/450 ms, a tap's click going
    through, movement cancelling the press, Android's context menu, the
    click guard's end. The repeat schedule (400, 550, 700, 850, 1000, 1060…)
    and the hold tracker: a tap is one step, a hold adds nothing on release,
    it stops at the max (no timer left) and on leaving, and it doesn't start
    at the end or for another mouse button.
  - `kitchen-gestures.test.ts` (new, 19): which activity rows swipe to Undo
    (your use and waste; never a bill, a payment, a dish, someone else's — even
    for an admin — an undone one, a reversal, a pending one or a viewer's);
    which history rows; the swipe's words; the menu's entries and links per
    item (usual, none, a viewer's, used up, wasted, not read); Home's item
    from its address; `atSmallest`; and the components rendered
    (react-dom/server): a swipe row is `pan-y` with no callout or selection,
    a payment's row is a plain row, and a repeat button is a plain button.
  - No existing test changed.
- **Browser check.** The production build ran under `wrangler dev` on 3881,
  behind the SM-2 proxy on 3882 with SM-11's mock. Headless Chrome ran at
  390×844 with touch emulation, driven by CDP `Input.dispatchTouchEvent`.
  All 15 checks passed:
  - **Pantry, short swipe:** 60 px of 356 sprang back and wrote nothing.
  - **Pantry, vertical drag:** a drag over the rows scrolled the page
    (`scrollY` 0 → 429), with no swipe and no write.
  - **Pantry, long swipe:** Milk revealed "Use 1 glass" and posted one
    `…/uses` `{ quantity: "250", unit: "ml", consumers: [you] }`. The toast
    read "Logged 1 glass · ₹17.00 · Undo", the row then read 750 ml, and
    the page stayed on `/pantry`.
  - **Pantry, no usual:** Paneer revealed "Use" and opened
    `/use?item=me:itm_…6`, with no write.
  - **Pantry, press:** holding Eggs opened "Eggs" with Use 2 pcs · Use some… ·
    Cook with it · Wasted · Open. The release opened nothing else, and no
    text was selected. Wasted showed "Throw away the 7 pcs left (₹49.00)? ·
    Nothing to split · Keep it · Mark wasted".
  - **Item history:** Milk's "You · 250 ml" revealed "Undo", posted
    `…/txns/txn_mov_…/reverse` and toasted "Undone · It's back in the
    pantry.".
  - **Home:** holding Greek yogurt opened Use 100 g · Use some… · Cook with
    it · Wasted · Open. Swiping it posted `…/uses` `{ quantity: "100",
    unit: "g" }` and toasted "Logged 100 g · ₹30.00 · Undo".
  - **Activity, rows that don't swipe:** a payment recorded from Home ("You
    paid veena.k · UPI"), Anu's payment and Dev's dish neither moved nor
    wrote.
  - **Activity, your own use:** Tomatoes revealed "Undo", posted
    `…/txns/txn_m3/reverse`, read "Undone" and toasted "Undone: Tomatoes ·
    Undo".
  - **Dish, hold +:** holding + on your portion of Egg fried rice stepped
    at 414, 558, 712, 863, 1017, 1080, 1143 and 1206 ms (gaps 144–154, then
    63). It stopped at 4 portions, the most free, with + disabled. The
    burst sent one `PUT …/claims/me` `{ portionsHalf: 8 }` and showed one
    toast, "You · 4 portions · ₹124.80 · Undo".
  - **Reduced motion:** the row followed the finger and was back at once,
    with no transition.
  - **Cook, hold −:** holding − on Onions stepped 100 → 25 g and stopped on
    "Take out onions"; the ingredient stayed.
  - The production build serves the same 20 pages as files, every kitchen
    page static.
- **For the owner, on real phones** (an iPhone installed and in Safari, an
  Android installed): the row swipe on Pantry and Home; Undo on your own
  activity and history rows (a payment doesn't move); the press menu,
  without iOS's link preview or Android's context menu; holding + and − on
  a dish's portions and Cook's steppers. Also check that a swipe and the
  page's own scroll, and PW-7's pull to refresh and edge swipe, don't take
  each other's touches.

### PW3 — push tests that pass every time (PW-10)

- **No production bug.** Both failures were in the tests. The worker's Web
  Push and its preferences PUT behave the same for real requests as before.
  - Every body the worker encrypts decrypts for the device it is addressed
    to: 600 of 600 in a diagnostic run, with nothing changed in
    `push/crypto.ts` or `push/deliver.ts`.
  - The RFC 8291 Appendix A vector still passes.
  - The PUT's only failure came from the test's own id stub.
  - The public keys PW-9 stored are 65-byte uncompressed points on P-256.
    The worker checks the private key against them at runtime.
- **"Cipher job failed" (`push-delivery.test.ts`, "goes out per kind…").**
  The cause was order. `pushToDevices` encrypts for every device at once
  (`Promise.all`), so requests reach the push service in whatever order
  their WebCrypto jobs finish. Node runs those jobs on its thread pool. The
  test decrypted `requests[2]` with the iPad's key, assuming the iPad's
  request came third.
  - Unloaded, 1 fan-out in 200 left out of order.
  - With six suites running beside it, 43 in 200 did, and 30 of those put
    another device's body third. AES-GCM's tag check then failed:
    `OperationError` / `Cipher job failed`.
  - That's why the file passed alone and failed in a full or busy run.
  - Fix: `bodyFor(service, endpoint)` in `push-fakes.ts`. Each device now
    decrypts its own body, found by endpoint.
  - New test, "pairs each body with its own device, whatever order the push
    services are reached in": it holds the three requests and releases
    them in reverse. It pins the order that used to fail, and checks that
    each body opens for its own device and for no other.
- **The preferences PUT's 500 (`push-enqueue.test.ts`, both PUT tests).**
  The cause was how jest was run, not the date or the branch. The test's
  stub was `generateUuid: () => crypto.randomUUID()`, with `crypto` the
  *default import* of `node:crypto`.
  - The package's `test` script runs jest with `--experimental-vm-modules`.
    The file then stays ESM and the import works.
  - Run jest without that flag and ts-jest compiles to CommonJS. Examples:
    `pnpm --dir tests/notifications-worker exec jest …`, or an editor's
    runner. `pnpm … test -- --runInBand` answers "No tests found", which
    steers people there.
  - In CommonJS, with `esModuleInterop: false`, the default import is
    `undefined`. The stub throws a `TypeError` inside the handler's `try`,
    and the catch-all answers 500. It fails every time in that mode: alone,
    on main or PW-5's branch, on any date.
  - The worker's own path is unaffected: it uses the global `crypto`.
  - Fix: the PUT tests generate their own ids.
- **"Only 110 tests ran."** This happened in the same CommonJS mode. ts-jest
  type-checked `notifications-service.test.ts` and could not resolve
  `@saas/db` (TS2307). That package has only `exports`, which this
  resolution ignores. The suite failed to run, and its 16 tests went
  uncounted.
  - It showed only sometimes. It depends on what jest's transform cache,
    shared by every checkout on the machine, already holds: it reproduces
    after an ESM run on the same cache.
  - Fix: `tests/notifications-worker/tsconfig.json` maps `@saas/db` and
    `@saas/db/ids` to source, as jest's `moduleNameMapper` already does.
- **Ruled out.**
  - The date: the test realm's clock, and both realms', set to 2026-11-08,
    -09, -10 and 2027-01-01: all pass.
  - The VAPID caches, and order between files: each file run in band before
    `push-enqueue`.
  - Random key material.
  - The suite now passes in both modes.
- **Tests.**
  - `tests/notifications-worker`: 127, one new.
  - The package script: 10 runs in a row in parallel, 10 in band, and 24
    runs under load (12 in band and 12 parallel at once; 9 of 24 failed
    before).
  - Each push file alone, in both modes.
  - `exec jest --runInBand`: 3 runs, 127 each.
- **A 500 now leaves a log line** (the reviewer's addition, since push is
  live). The notifications-worker's seven catch-alls (router, enqueue, push,
  get/put preferences, get notification, create suppression) call
  `logUnexpected(where, requestId, err)` (`src/http.ts`): one
  `console.error` with where, the request id and the error's name and
  message (cut to 300 characters), never the request body, a token, a key or
  an address. `log-unexpected.test.ts` pins it.
