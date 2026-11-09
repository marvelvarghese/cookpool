# cookpool-mcp — risks and open questions

## MC-A — A leaked assistant token (RISK)

Scopes are enforced at api-edge with an allowlist, never in mcp-worker alone. Delegated tokens can't call auth or account routes or any money write, and a test enumerates every write route. Disconnect revokes at once, apart from the 30 s actor cache.

## MC-B — Prompt injection through the assistant (RISK)

An assistant may be steered by content it reads. To contain that:
- tools only read the user's own data;
- writes are suggestions a human confirms in Cookpool;
- tool descriptions are plain and make no claims.

## MC-C — Gemini availability (ACCEPTED)

Gemini's consumer custom apps are reportedly limited by country, language and account settings. The connector is standard, so Claude, ChatGPT, Gemini Enterprise and CLI clients work too.

## MC-D — Custom domain (ACCEPTED)

The workers.dev host works first. The branded host is a dashboard step for the owner, like the console's. The terraform domain stack is parked.

## MC-E — OAuth library and SDK on Workers (RISK)

`@cloudflare/workers-oauth-provider` and the MCP TypeScript SDK's Streamable HTTP server need to fit Workers. MC-3 confirms both with a dry-run bundle before building the tools.
