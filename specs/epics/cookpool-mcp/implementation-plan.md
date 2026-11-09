# cookpool-mcp — implementation plan

Each task is one pull request on `orun/MC-k-<slug>`, with its contract in `tasks/MC-k.TaskContract.yaml`.

## MC0 — the spec

- **MC-1:** this doc set and the contracts.

## MC1 — connect and read

- **MC-2: delegated tokens and scope enforcement** (design §1; identity migration 490). identity-worker and api-edge.
- **MC-3: mcp-worker** (design §2). A new worker and KV, OAuth, Streamable HTTP, and the read and timer tools.
- **MC-4: consent and Connected assistants in the app** (design §3).

**Done when**
- an MCP client adds the stage URL and the owner approves on `/connect`
- the assistant lists the pantry, and a timer it sets rings on the phone
- Disconnect stops it

## MC2 — suggestions

- **MC-5: suggestions in the server, plus the propose tools** (design §4; migration 500).
- **MC-6: suggestion cards on Home** (design §4).
- **MC-7: close-out.**

## Sequencing

- MC-2 and MC-3 start together. MC-3 uses MC-2's routes and needs MC-2 on main before its end-to-end tests.
- MC-4 follows design approval and MC-2.
- Then MC-5, then MC-6.
