# chat-sdk-mcp

> npm package: [`chat-sdk-mcp`](https://www.npmjs.com/package/chat-sdk-mcp)

[![npm version](https://img.shields.io/npm/v/chat-sdk-mcp?style=flat-square&logo=npm&logoColor=white&labelColor=000&color=000)](https://www.npmjs.com/package/chat-sdk-mcp)
[![npm downloads](https://img.shields.io/npm/dm/chat-sdk-mcp?style=flat-square&labelColor=000&color=000)](https://www.npmjs.com/package/chat-sdk-mcp)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](./LICENSE)

MCP server for [Chat SDK](https://chat-sdk.dev). It gives AI agents the chat channels your bot already has, Slack, Telegram, WhatsApp, Teams or any other adapter, through the tools Chat SDK defines in `chat/ai`: read threads and messages, post, reply, edit, delete, react, open DMs and look users up. It runs over stdio or Streamable HTTP, as a CLI, inside your own MCP server, or as a serverless route.

## Installation

```bash
pnpm add chat-sdk-mcp chat @modelcontextprotocol/server
```

Add the adapters your bot uses, such as `@chat-adapter/slack`. ESM only, Node >= 20. `chat` and `@modelcontextprotocol/server` are peers, so you control their versions.

## Usage

### From an MCP client

Point `CHAT_MCP_ADAPTERS` at the catalog adapters you use. Each one reads its own variables, the same ones it reads in a bot:

```json
{
  "mcpServers": {
    "chat": {
      "command": "npx",
      "args": ["chat-sdk-mcp"],
      "env": {
        "CHAT_MCP_ADAPTERS": "slack,telegram",
        "SLACK_BOT_TOKEN": "xoxb-…",
        "SLACK_SIGNING_SECRET": "…",
        "TELEGRAM_BOT_TOKEN": "…"
      }
    }
  }
}
```

Run it from the project that has `chat-sdk-mcp` and the adapters installed. A missing adapter fails at startup with the package to install.

### Inside your own MCP server

`registerChatTools` adds the tools to any MCP server, next to your own:

```typescript
import { McpServer } from "@modelcontextprotocol/server";
import { CHAT_MCP_INSTRUCTIONS, registerChatTools } from "chat-sdk-mcp";
import { bot } from "./lib/bot";

const server = new McpServer(
  { name: "my-app", version: "1.0.0" },
  { instructions: CHAT_MCP_INSTRUCTIONS },
);

const tools = registerChatTools(server, { chat: bot, preset: "reader" });
tools.fetch_messages?.update({ description: "Read a support conversation." });
```

It returns the SDK handle of each tool, so you can rename, describe, wrap, disable or remove any of them.

### Serverless

`createChatMcpHandler` serves the tools over Streamable HTTP, statelessly, from any `fetch` runtime: Vercel Functions, Next.js route handlers, Hono, Bun or Workers.

```typescript title="app/api/mcp/route.ts"
import { createChatMcpHandler } from "chat-sdk-mcp";
import { bot } from "@/lib/bot";

const mcp = createChatMcpHandler({ chat: bot });

export async function POST(request: Request): Promise<Response> {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.MCP_TOKEN}`
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  return mcp.fetch(request);
}
```

The handler checks no credentials, so authenticate the request first. With Vercel's [`mcp-handler`](https://github.com/vercel/mcp-handler), register the tools on the server it gives you:

```typescript
import { createMcpHandler } from "mcp-handler";
import { CHAT_MCP_INSTRUCTIONS, registerChatTools } from "chat-sdk-mcp";

const handler = createMcpHandler(
  (server) => {
    registerChatTools(server, { chat: bot });
  },
  { instructions: CHAT_MCP_INSTRUCTIONS },
);

export { handler as GET, handler as POST };
```

## Configuration

`createChatMcpServer`, `registerChatTools` and `createChatMcpHandler` take the same options:

| Option           | Default    | Description                                                                                                                     |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `chat`           | –          | The `Chat` instance whose adapters the tools reach                                                                              |
| `bots`           | –          | Several `Chat` instances by id, or a `BotSource`, in place of `chat`. Every tool then takes a `bot`, and `list_bots` names them |
| `botDescription` | –          | How the `bot` input is described to agents, when your bots are, say, channels                                                   |
| `preset`         | every tool | Chat SDK's `reader`, `messenger` or `moderator`, or several                                                                     |
| `scope`          | –          | Confine the tools to one thread or channel id, as in Chat SDK                                                                   |
| `strictScope`    | `false`    | Confine a thread scope to that thread alone                                                                                     |

### Without code

The CLI, and `loadConfig` from `chat-sdk-mcp/config`, build the `Chat` from one of these:

- **`CHAT_MCP_ADAPTERS`**: catalog slugs such as `slack,telegram`, each built with its own variables, and `CHAT_MCP_STATE` for the state adapter (memory by default).
- **`CHAT_MCP_CONFIG`**: a JSON file, inline JSON, or a module that exports your bot as `default` or `bot`, such as `./lib/bot.ts`.

The JSON form is `new Chat({ adapters, state, userName, logger })` with each adapter replaced by an entry. An entry is a catalog slug, the key by default, or a package and its factory, and `config` is the factory's argument. `${VAR}` and `${VAR:-default}` read the environment, so secrets stay out of the file:

```json
{
  "adapters": {
    "slack": {},
    "telegram": { "config": { "mode": "webhook" } },
    "whatsapp": {
      "packageName": "chat-adapter-wwebjs",
      "factoryExport": "createWWebJSAdapter",
      "config": { "adapterName": "whatsapp" }
    }
  },
  "state": { "slug": "redis", "config": { "url": "${REDIS_URL}" } }
}
```

For several bots, put one such object per id under `bots`: `{ "bots": { "sales": { … }, "support": { … } } }`.

```typescript
import { createChatMcpServer } from "chat-sdk-mcp";
import { loadConfig } from "chat-sdk-mcp/config";

const server = createChatMcpServer(await loadConfig("./chat-sdk-mcp.json"));
```

## Environment variables

| Variable              | Default        | Description                                                                      |
| --------------------- | -------------- | -------------------------------------------------------------------------------- |
| `CHAT_MCP_ADAPTERS`   | –              | Catalog slugs of the adapters to build, comma-separated                          |
| `CHAT_MCP_STATE`      | `memory`       | Catalog slug of the state adapter, with `CHAT_MCP_ADAPTERS`                      |
| `CHAT_MCP_CONFIG`     | –              | JSON file, inline JSON, or a module exporting your bot                           |
| `BOT_USERNAME`        | `chat-sdk-mcp` | The bot's `userName` when the config sets none                                   |
| `CHAT_MCP_PRESET`     | every tool     | `reader`, `messenger` or `moderator`, comma-separated                            |
| `CHAT_MCP_HOST`       | `127.0.0.1`    | `chat-sdk-mcp http`: the address to listen on                                    |
| `CHAT_MCP_PORT`       | `3000`         | `chat-sdk-mcp http`: the port; the endpoint is `/mcp`                            |
| `CHAT_MCP_AUTH_TOKEN` | –              | `chat-sdk-mcp http`: the bearer token, required off this machine, 16+ characters |

`chat-sdk-mcp` serves stdio, and `chat-sdk-mcp http` serves Streamable HTTP.

## Tools

Most tools are Chat SDK's own, from `chat/ai`, with the same inputs and behavior. chat-sdk-mcp adds what its toolset leaves out. Thread ids (`slack:C123:1700000000.000100`) and channel ids (`slack:C123`) are full Chat SDK ids.

| Tool                      | What it does                                                          | Annotations |
| ------------------------- | --------------------------------------------------------------------- | ----------- |
| `list_adapters`           | Each adapter, with the tools that work on it                          | read-only   |
| `list_bots`               | The bot ids, with several bots                                        | read-only   |
| `fetch_messages`          | A thread's messages, paged                                            | read-only   |
| `fetch_channel_messages`  | A channel's top-level messages, paged                                 | read-only   |
| `fetch_message`           | One message by id                                                     | read-only   |
| `fetch_thread`            | A thread's channel and whether it is a DM                             | read-only   |
| `list_threads`            | A channel's threads, paged                                            | read-only   |
| `get_thread_participants` | The people in a thread, bots left out                                 | read-only   |
| `get_channel_info`        | A channel's name, member count and visibility                         | read-only   |
| `get_user`                | A user's profile, `null` when unknown                                 | read-only   |
| `post_message`            | Post in a thread, or reply to a message in it with `replyToMessageId` |             |
| `post_channel_message`    | Post at the top of a channel                                          |             |
| `send_direct_message`     | DM a user                                                             |             |
| `open_dm`                 | The DM thread with a user, to read or post                            | idempotent  |
| `start_typing`            | Show the typing indicator                                             | idempotent  |
| `mark_as_read`            | Mark a message as read                                                | idempotent  |
| `add_reaction`            | React to a message                                                    | idempotent  |
| `edit_message`            | Edit the bot's message                                                | destructive |
| `delete_message`          | Delete a message                                                      | destructive |
| `remove_reaction`         | Remove a reaction                                                     | destructive |

`get_user`, `send_direct_message` and `open_dm` take an `adapter` when Chat SDK cannot tell it from the user id, as with WhatsApp numbers. Chat SDK's thread subscriptions are left out, since they change how a live bot answers.

`list_adapters` lists, for each adapter, the tools it implements, and for adapters built from the catalog also leaves out what the catalog says it lacks. A tool an adapter cannot do fails with a message that says so.

## Results and errors

A result is the tool's output as `structuredContent` and the same JSON as text. A result that can be null comes under its key, such as `{ "user": null }`. An error, from Chat SDK, the platform or chat-sdk-mcp, is a tool error carrying its message, such as `Rate limited by slack, retry after 30s`. Nothing wraps either, so a host that wants its own envelope can wrap the tools with their handles.

## Limits

- **Adapters are fixed when the `Chat` is built.** Change the configuration and restart to add one.
- **chat-sdk-mcp next to a live bot**: reading cached history, as WhatsApp and Telegram keep it, needs the bot's own state adapter. Telegram in polling mode allows a single consumer, so set `"mode": "webhook"` for chat-sdk-mcp when the bot already polls.
- **No credentials go through tools.** They stay in the environment or the config.

## License

MIT
