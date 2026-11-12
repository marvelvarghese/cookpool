# cookpool-spliteco — risks and open questions

## SE-A — SE1 is one large pull request (RISK, mitigated)

The playbook puts each milestone in one PR, and SE1 carries a worker, an app and a migration. Mitigations:
- the contract lists each done-when fact;
- each suite is run locally before the PR;
- the app is browser-checked against stage before landing.

## SE-B — two workers write one ledger (RISK, mitigated)

kitchen-worker and spliteco-worker both write `kitchen_txns`. Mitigations:
- both write only through `packages/db/src/kitchen/ledger.ts` statements, which check Σpaid = Σowed = total;
- `idem_key` is unique per org;
- `app` names the writer, and Spliteco refuses to edit `app = 'cookpool'` rows.

## SE-C — rounding rule differs from the canvas (RESOLVED)

The canvas said leftover paise go to the payer. Cookpool's engine gives them to the largest fraction, with ties to the earlier position. One ledger needs one rule, so the engine's rule is kept and the canvas note is corrected.

## SE-D — a second app on its own host needs its own session (RISK, mitigated)

The console's session cookie is scoped to its host. spliteco-web copies the console's sign-in plumbing against the same identity-worker. Opening Spliteco from Cookpool carries a one-time 60-second code (SE3), so it is one tap, already signed in.

## SE-E — live split without a socket (SETTLED)

Polling every 2 seconds is enough for a table of people. Revisit if sessions grow past 20 people or polling cost shows in metering.

## SE-F — assistants writing money (RESOLVED)

Under the cookpool-ai and cookpool-mcp rules, money never moves on an AI's word. Logging an expense is allowed under `money.write` because the user confirms a draft first. Settlements are never allowed. Every write records its delegation, so Activity can say "via <assistant>".

## SE-G — custom domain (ACCEPTED)

The app runs on its workers.dev host until the owner attaches a domain in the Cloudflare dashboard, as with the console.

## SE-H — direct groups multiply orgs (ACCEPTED)

Each pair of friends with an expense outside groups gets a hidden organization. That is cheap in D1, and it keeps every expense group-scoped. These organizations are excluded from the open-groups cap (50 per person).

## SE-I — two balances can confuse (RISK, mitigated)

A kitchen group shows ₹860 in Cookpool and ₹4,860 in Spliteco when ₹4,000 of rent was added in Spliteco. Mitigations: Spliteco labels the two balances ("Kitchen ₹860 · Other ₹4,000"), the kitchen number is identical in both apps, and payments allocate kitchen-first, so Cookpool can never show a balance flipped by money it doesn't list.
