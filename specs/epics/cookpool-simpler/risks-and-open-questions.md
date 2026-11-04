# cookpool-simpler — risks and open questions

## SM-A — moving the database deletes what is in it (ACCEPTED, owner's call)

Recreating D1 in Asia–Pacific starts stage and prod empty. On 2026-11-04 both
hold only test data from the move to the new account (SI-10), and the owner
approved the plan that said so. After this, moving the database again would
need an export and import.

## SM-B — the API route needs a dashboard step (RISK)

The brokered deploy token has no zone rights, so the Workers Routes
`cookpool.store/api/*` and `stage.cookpool.store/api/*` are added by the
owner in the Cloudflare dashboard. Until they exist, the app keeps calling
the workers.dev API and the preflight cost stays.

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
