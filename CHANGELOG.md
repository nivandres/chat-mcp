# Changelog

## 0.1.0

Initial release: an MCP server for Chat SDK, over stdio and Streamable HTTP.

- Chat SDK's own tools from `chat/ai`, in snake_case, with titles and the annotations MCP clients confirm writes by. Its presets and `scope` apply as they do in Chat SDK; its thread subscriptions are left out.
- What Chat SDK's toolset lacks: `fetch_message`, `mark_as_read`, `open_dm`, replies through `post_message`'s `replyToMessageId`, and an `adapter` on `get_user`, `send_direct_message` and `open_dm` for user ids Chat SDK cannot route.
- `list_adapters` lists each adapter with the tools that work on it, from what it implements and, for adapters built from the catalog, what the catalog says it supports.
- `registerChatTools` adds the tools to any MCP server, `mcp-handler`'s included, and returns their handles. `createChatMcpServer` builds a server, and `createChatMcpHandler` serves one from any `fetch` runtime.
- Several bots by id, or loaded per call from a `BotSource`, with a `bot` on every tool and `list_bots`.
- `chat-mcp/config` builds the `Chat` from catalog slugs in `CHAT_MCP_ADAPTERS`, a JSON file or inline JSON with `${VAR}` references, or a module exporting your bot. An adapter that is missing, unknown or misnamed fails at startup with what to do.
- The `chat-mcp` CLI serves stdio, or Streamable HTTP with `chat-mcp http`, behind a bearer token off this machine.
