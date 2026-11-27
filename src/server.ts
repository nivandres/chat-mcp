import {
  type CreateMcpHandlerOptions,
  createMcpHandler,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import { type ChatMcpOptions, registerChatTools } from "./register";

declare const __VERSION__: string;

/** What the server tells agents before they call a tool; reuse it when you register the tools on your own server. */
export const CHAT_MCP_INSTRUCTIONS =
  "Chat SDK tools for the chat adapters behind this server. Call list_adapters first: it names each adapter and the tools that work on it (call list_bots first when tools take a bot). Thread ids (slack:C123:1700000000.000100) and channel ids (slack:C123) are full Chat SDK ids that start with the adapter name; pass them back unchanged. Message and user ids are the platform's own. Paged reads return nextCursor; pass it back as cursor.";

/**
 * An MCP server with every Chat SDK tool, for one `Chat` or several.
 *
 * @example
 * ```ts
 * import { serveStdio } from "@modelcontextprotocol/server/stdio";
 *
 * serveStdio(() => createChatMcpServer({ chat: bot }));
 * ```
 */
export function createChatMcpServer(options: ChatMcpOptions): McpServer {
  const server = new McpServer(
    { name: "chat-mcp", title: "Chat SDK", version: __VERSION__ },
    { instructions: CHAT_MCP_INSTRUCTIONS },
  );
  registerChatTools(server, options);
  return server;
}

/**
 * A web-standard handler serving `createChatMcpServer` over Streamable HTTP,
 * statelessly, for serverless functions, route handlers and any `fetch` runtime.
 * It checks no credentials: authenticate the request first and pass `authInfo`.
 *
 * @example
 * ```ts
 * // app/api/mcp/route.ts
 * const mcp = createChatMcpHandler({ chat: bot });
 * export const POST = (request: Request) => mcp.fetch(request);
 * ```
 */
export function createChatMcpHandler(
  options: ChatMcpOptions,
  handlerOptions?: CreateMcpHandlerOptions,
): McpHttpHandler {
  return createMcpHandler(() => createChatMcpServer(options), handlerOptions);
}
