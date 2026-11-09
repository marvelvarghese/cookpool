// MCP at /mcp (design §2): Streamable HTTP, stateless.
//
// The provider has already checked the access token and decrypted the
// grant's props into ctx.props. Each request builds a server that lists only
// the tools whose scope the person allowed (and the token still carries), and
// answers JSON (no SSE stream: nothing here pushes). Tools reach api-edge
// with the delegated token, where the scopes are enforced again.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OAuthResourceAuth } from "@cloudflare/workers-oauth-provider";
import { isAssistantScope, type AssistantScope } from "@saas/contracts/mcp-connect";
import type { Env, GrantProps } from "./env.js";
import { requestIdOf } from "./http.js";
import { KITCHEN_TOOLS } from "./tools/kitchen.js";
import { MONEY_TOOLS, TIMER_TOOLS } from "./tools/money-timers.js";
import { errorText, isEdgeError, type ToolContext, type ToolDef } from "./tools/types.js";

export const SERVER_INFO = { name: "cookpool", title: "Cookpool", version: "1.0.0" } as const;

export const SERVER_INSTRUCTIONS =
  "Cookpool keeps a person's pantries, recipes, shopping list and shared-cost balances. " +
  "These tools read them and set kitchen timers. Nothing here moves money. " +
  "Ids from one result (itm_, rcp_, tmr_, org_) can be passed to another tool.";

/** Every tool this server has, in the order it lists them (MC-5 adds suggest_use and suggest_purchase). */
export const ALL_TOOLS: ToolDef[] = [...KITCHEN_TOOLS, ...MONEY_TOOLS, ...TIMER_TOOLS] as unknown as ToolDef[];

/** The scopes in force: what the grant holds, narrowed to what this access token carries. */
export function grantedScopes(props: GrantProps, auth: OAuthResourceAuth | undefined): Set<AssistantScope> {
  const token = auth ? new Set(auth.scope) : null;
  return new Set(props.scopes.filter(isAssistantScope).filter((s) => !token || token.has(s)));
}

export function toolsFor(scopes: Set<AssistantScope>): ToolDef[] {
  return ALL_TOOLS.filter((tool) => scopes.has(tool.scope));
}

export function buildServer(tools: ToolDef[], ctx: Omit<ToolContext, "now">): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
    // Ajv compiles schemas with `new Function`, which Workers forbid.
    jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
  });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.readOnly,
          openWorldHint: false,
        },
      },
      async (args: unknown): Promise<CallToolResult> => runTool(tool, args, { ...ctx, now: Date.now() }),
    );
  }
  if (tools.length === 0) {
    // The SDK advertises tools only once one is registered; a grant whose
    // scopes list none (suggest.write before MC-5) still answers tools/list.
    server.server.registerCapabilities({ tools: { listChanged: false } });
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
    server.server.setRequestHandler(CallToolRequestSchema, (request) => ({
      isError: true,
      content: [{ type: "text", text: `Cookpool didn't allow ${request.params.name}.` }],
    }));
  }
  return server;
}

export async function runTool(tool: ToolDef, args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  let outcome;
  try {
    outcome = await tool.run(args as never, ctx);
  } catch {
    return { isError: true, content: [{ type: "text", text: "Cookpool isn't answering right now. Try again shortly." }] };
  }
  if (isEdgeError(outcome)) return { isError: true, content: [{ type: "text", text: errorText(outcome) }] };
  return {
    content: [
      { type: "text", text: outcome.summary },
      { type: "text", text: JSON.stringify(outcome.data) },
    ],
  };
}

type McpContext = ExecutionContext & { props?: GrantProps; auth?: OAuthResourceAuth };

/** The provider's apiHandler for /mcp. */
export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: McpContext): Promise<Response> {
    const props = ctx.props;
    if (!props?.delegatedToken) {
      return Response.json({ error: "invalid_token", error_description: "Connect Cookpool again." }, { status: 401 });
    }
    const tools = toolsFor(grantedScopes(props, ctx.auth));
    const server = buildServer(tools, { env, bearer: props.delegatedToken, requestId: requestIdOf(request) });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true }) // no sessionIdGenerator: stateless;
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      ctx.waitUntil?.(server.close());
    }
  },
};
