# cookpool-sign-in (SI) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SI0 — the spec | ✅ shipped 2026-11-02 | #26 (SI-1) |
| SI1 — sign-in that holds up | | |
| SI2 — the Cookpool sign-in page | in progress | #27 (SI-4) |
| SI3 — first run and You | | |

## Departures from the design

### SI2 — the signed-out join preview (SI-4)

Route as built: `GET /v1/join/{code}/preview` → `{ groupName,
inviterFirstName, memberCount }` (`JoinPreviewPublic`; the key list is
`JOIN_PREVIEW_PUBLIC_KEYS` in `@saas/contracts/membership`), served by
membership-worker (`handlers/join-preview-public.ts`) and routed by api-edge
(`join-preview-facade.ts`) without a session. SDK:
`client.memberships.previewJoinPublic(code)`.

- **"The inviter" is the group's first owner.** CP-3 keeps the join code on
  the organization row with nobody's id beside it (a rotation's actor is only
  in the event log, and the first mint is in neither), so who made a link is
  not recorded. The preview names the earliest-joined active member holding
  the owner role (people only, never a service principal).
- **The name is the first word of their profile name, else null.** Not the
  part of the email before the @ that CP-9's names fall back to: this answer
  goes to people with no account, so no piece of an address is shown. A first
  word containing `@` is treated as no name.
- **membership-worker binds `IDENTITY_WORKER`** (stage and prod) for the name,
  through CP-9's internal lookup. identity-worker already depends on
  membership-worker, so the binding is not a `dependsOn` edge; like CP-19's
  kitchen binding it is acknowledged in tests/config-worker
  (`ACKNOWLEDGED_BINDING_CYCLES`). A failed or missing lookup answers without
  a name, never an error.
- **`memberCount` counts people with a group role** (owner, admin, member,
  viewer — CP-9's count): removed members, revoked roles and a
  billing_admin-only seat are not counted. The signed-in preview
  (`GET /v1/join/{code}`) still counts every active member row; it is
  unchanged.
- **One 404 for every code that names no joinable group**: unknown, malformed,
  rotated away, or a group that is not active. CP-3 has no "join links off"
  switch (rotating is how a group stops a link), so there is nothing else to
  refuse. A malformed code answers before any read; every other miss costs
  the same single lookup.
- **Its own rate-limit family, `join_preview`: 30 a minute per IP.** The
  design said "the same per-IP signed-out bucket"; it is the same mechanism
  (`anon:<family>:<ip>`), in a family of its own so it and sign-in (`auth`,
  10 a minute) do not spend each other's budget. Unlike every other family it
  is keyed by IP even when a token is sent: otherwise a fresh random
  `Authorization` header per request would buy a fresh bucket each time.
- **The edge re-picks the three fields** from membership-worker's 200 (a body
  without them is a 503), forwards only `x-request-id` and `traceparent` (no
  token, cookie, actor header, query or body), and every answer from the
  route, errors and 429s included, carries `Cache-Control: no-store`. The
  Solo profile hides it with the other join routes.
- **The SDK sends no credential on it**, even from a signed-in client (the
  transport's new `anonymous` request flag).
