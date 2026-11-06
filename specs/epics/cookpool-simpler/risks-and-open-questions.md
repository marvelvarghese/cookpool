# cookpool-simpler — risks and open questions

## SM-A — moving the database deletes what is in it (ACCEPTED, owner's call)

Recreating D1 in Asia–Pacific starts stage and prod empty. On 2026-11-04 both
hold only test data from the move to the new account (SI-10), and the owner
approved the plan that said so. After this, moving the database again would
need an export and import.

## SM-B — every API call now passes through the console Worker (RISK)

The API on the app's address is a service binding from the console Worker to
api-edge (design §1.2 item 2), so it needs no zone rights and no dashboard
step (the Workers Route it replaced would have, and the brokered deploy token
has none). The price is that each API call runs the console Worker first, and
a cold console isolate was the slow part of SM-2's measurements (a 16 MB
script). Its entry answers `/api` before OpenNext is imported, so such an
isolate never evaluates the Next code; but wrangler still uploads one script,
which a cold isolate still loads. If the timing check shows `/api` reads over
budget where api-edge's workers.dev host is within it, the ways out are a
Workers Route on the zone for `/api/*` (the dashboard step) or a separate
small Worker in front of the console.

Two more things this rests on, both checked on every deploy: api-edge tells
the console's binding from the internet by the binding's `props` (the stage
smoke requires `/api/health` to report the console's forwarded address, or
prod does not deploy); and the console deploys after api-edge on main.

## SM-C — static pages and the environment (RISK)

SI-12 resolved the environment on the server from the host. Moving that to
the browser means the first paint knows its environment only after
JavaScript runs. The app must not call the wrong API in that moment: it
resolves the config before the first fetch, from `window.location` and the
custom-domain map the build carries.

## SM-D — optimistic writes can show something the server refuses (ACCEPTED)

A write that the server refuses (stock ran out, a portion limit) rolls back
with a one-line reason. The money is always the server's: a rollback never
leaves a balance the server did not compute.

## SM-E — anyone setting anyone's portion can be misused (ACCEPTED)

Any member can say another member had a portion. The row shows who set it,
the person is emailed and can change it, and the cook finalizes. Groups are
small and know each other; this is the same trust as logging a use for
someone, which exists today.

## SM-F — a measure is a guess at a size (ACCEPTED)

"1 onion ≈ 150 g" is what the group says an onion weighs, not a weighing.
Two people who think differently pay slightly differently for "an onion",
and big and small onions under one name share one size. Accepted: the sizes
are set by the group, shown with "≈", changeable by anyone who can use the
item, and "The rest" settles the last of an item exactly, so the money adds
up to what was paid. No built-in sizes, so nothing is guessed for them.

