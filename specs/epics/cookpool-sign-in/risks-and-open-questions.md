# cookpool-sign-in — risks and open questions

## SI-A — Google needs a secret only the owner has (RISK)

Switching Google on needs the OAuth client secret from the Google Cloud
project that owns the client id in identity-worker's config, and both
callback URLs registered there. Nobody else can supply it. Until then, SI-3
waits, and prod sign-in depends on emailed codes, which need the mail domain
(SI-B). The page shows Google only when the providers list has it, so
nothing else waits.

## SI-B — codes on prod need the mail domain (RISK)

notifications-worker sends from `no-reply@mail.cookpool.app`, and
`cookpool.app` is not registered. Until it is registered and set up for
Cloudflare Email, a code requested on prod never arrives. The fix is an
owner's setup step, outside this epic (`cookpool-kitchen` → "After v1",
item 1). Google is the way in until then.

## SI-C — stage shows every code on screen (ACCEPTED, owner's call)

SI-2 limited stage's on-screen codes to `@cookpool.test`. Stage sends no
email yet, so real addresses could not sign in there, and SI-9 (2026-11-03,
at the owner's request) shows the code for every address again. Anyone who
types someone's email on stage can sign in as them there. Stage is a test
environment with no real people's data; keep it that way while this holds,
and set stage back to `cookpool.test` (or empty) once email is delivered.
Prod never returns or shows a code.

## SI-D — the address limit can be used to annoy (ACCEPTED)

Five code requests in 15 minutes for someone else's address stop that person
from requesting a code for up to 15 minutes. They can still use Google. This
is the usual trade for a per-address limit, and it is still better than none.

## SI-E — the join preview shows a group's name to anyone with the link (ACCEPTED)

`GET /v1/join/{code}/preview` answers without a session: the group's name,
the inviter's first name and the member count. The code already lets its
holder join, so this shows less than joining would. Nothing else is
returned: no ids, no other names, no emails. A rotated code stops answering.

## SI-F — tokens live in the browser (ACCEPTED, baseline)

The baseline keeps the session token in the browser and hands it over in the
URL fragment after Google. This epic does not change that. Cookies with
`HttpOnly` would be safer against script injection; that is a baseline-wide
change for a later epic.

## SI-G — one sign-in page for two apps (SETTLED)

The admin `(app)` console and Cookpool share `/login`. It becomes Cookpool's
page, and the admin console keeps working through it (`?next=` returns
there). Developers keep the Bearer-token form behind "Developer sign-in" on
local and dev builds.
