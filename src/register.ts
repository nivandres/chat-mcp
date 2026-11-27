import { getCatalogEntry, getFeatureSupport } from "@chat-adapter/catalog";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import type { Adapter } from "chat";
import {
  type ChatBinding,
  type ChatToolName,
  type ChatToolPreset,
  createTanStackTools,
  type TanStackChatToolsOptions,
  type TanStackTool,
} from "chat/ai/tanstack";
import { z } from "zod";
import { type Guard, guardFor } from "./scope";
import {
  CHAT_TOOLS,
  type ChatMcpToolName,
  DISCOVERY,
  EXTENSIONS,
  OWN_TOOLS,
  RESULT_KEYS,
  type ToolSpec,
} from "./tools";

type MaybePromise<T> = T | Promise<T>;

/** Bots looked up by id on each call, so a host can load them lazily, per tenant. */
export interface BotSource {
  list(): MaybePromise<string[]>;
  load(id: string): MaybePromise<ChatBinding | undefined>;
}

/**
 * What `registerChatTools` and `createChatMcpServer` take: one `Chat`, or several
 * by id, plus Chat SDK's own tool options. Approval is left out: MCP clients ask
 * for it from each tool's annotations.
 */
export type ChatMcpOptions = Omit<
  TanStackChatToolsOptions,
  "chat" | "overrides" | "requireApproval"
> &
  (
    | { chat: ChatBinding; bots?: never }
    | { bots: Record<string, ChatBinding> | BotSource; chat?: never }
  );

/** The SDK handle of each registered tool, to rename, retitle, wrap, disable or remove it. */
export type RegisteredChatTools = Partial<
  Record<ChatMcpToolName, RegisteredTool>
>;

/** The catalog slug of each adapter chat-mcp built itself, so its catalog features can hide what it lacks. */
export const catalogSlugs = new WeakMap<ChatBinding, Record<string, string>>();

const BOT_INPUT = z.string().describe("Bot id, as list_bots names it");

function sourceOf(bots: Record<string, ChatBinding> | BotSource): BotSource {
  if (typeof bots.list === "function" && typeof bots.load === "function") {
    return bots as BotSource;
  }
  const record = bots as Record<string, ChatBinding>;
  return { list: () => Object.keys(record), load: (id) => record[id] };
}

function structured(data: unknown) {
  const structuredContent =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function supports(
  adapter: Adapter,
  spec: ToolSpec,
  slug: string | undefined,
): boolean {
  if (spec.method && typeof adapter[spec.method] !== "function") return false;
  const entry = slug && getCatalogEntry(slug);
  return (
    !entry ||
    !spec.feature ||
    getFeatureSupport(entry, spec.feature).status !== "no"
  );
}

/**
 * Registers Chat SDK's tools, `list_adapters` and, with several bots, `list_bots`
 * on an MCP server. Each tool also takes a `bot` when several are given.
 *
 * @example
 * ```ts
 * const server = new McpServer({ name: "my-app", version: "1.0.0" });
 * registerChatTools(server, { chat: bot, preset: "reader" });
 * ```
 */
export function registerChatTools(
  server: Pick<McpServer, "registerTool">,
  { chat, bots, ...options }: ChatMcpOptions,
): RegisteredChatTools {
  const source = chat ? undefined : sourceOf(bots);
  const presets = options.preset && [options.preset].flat();
  const toolsets = new WeakMap<ChatBinding, Map<string, TanStackTool>>();
  const guards = new WeakMap<ChatBinding, Guard>();
  const tools: RegisteredChatTools = {};
  const specs: ToolSpec[] = [];

  const toolset = (bound: ChatBinding) => {
    let byName = toolsets.get(bound);
    if (!byName) {
      byName = new Map(
        createTanStackTools({
          ...options,
          chat: bound,
          requireApproval: false,
        }).map((tool) => [tool.name, tool]),
      );
      toolsets.set(bound, byName);
    }
    return byName;
  };

  const guard = (bound: ChatBinding) => {
    let check = guards.get(bound);
    if (!check) {
      check = guardFor(bound, options.scope, options.strictScope);
      guards.set(bound, check);
    }
    return check;
  };

  const resolve = async (bot: unknown) => {
    if (chat) return chat;
    const bound = await source?.load(String(bot));
    if (!bound) {
      throw new Error(`Unknown bot "${bot}". Call list_bots for the bot ids.`);
    }
    return bound;
  };

  const register = (
    spec: ToolSpec,
    description: string,
    input: z.ZodObject,
    run: (bound: ChatBinding, input: Record<string, unknown>) => unknown,
  ) => {
    tools[spec.name as ChatMcpToolName] = server.registerTool(
      spec.name,
      {
        title: spec.title,
        description,
        inputSchema: source ? input.extend({ bot: BOT_INPUT }) : input,
        annotations: spec.annotations,
      },
      async ({ bot, ...args }: Record<string, unknown>) => {
        const bound = await resolve(bot);
        await bound.initialize();
        return structured(await run(bound, args));
      },
    );
  };

  for (const tool of createTanStackTools({
    ...options,
    chat: chat ?? ({} as ChatBinding),
    requireApproval: false,
  })) {
    const name = tool.name as ChatToolName;
    const spec: ToolSpec | undefined =
      CHAT_TOOLS[name as keyof typeof CHAT_TOOLS];
    if (!spec) continue;
    const extension = EXTENSIONS[name];
    const key = RESULT_KEYS[name];
    const input = tool.inputSchema as z.ZodObject;
    specs.push(spec);
    register(
      spec,
      tool.description,
      extension ? input.extend(extension.input) : input,
      async (bound, args) => {
        const extended = await extension?.run(bound, args, guard(bound));
        if (extended !== undefined) return extended;
        const result = await toolset(bound).get(name)?.execute(args);
        return key ? { [key]: result } : result;
      },
    );
  }

  for (const own of OWN_TOOLS) {
    if (
      presets &&
      !own.presets.some((preset: ChatToolPreset) => presets.includes(preset))
    ) {
      continue;
    }
    specs.push(own);
    register(own, own.description, own.input, (bound, args) =>
      own.run(bound, args as never, guard(bound)),
    );
  }

  register(
    { name: "list_adapters", title: "List adapters", annotations: DISCOVERY },
    "List the chat adapters this server reaches, each with the tools that work on it. Thread and channel ids start with the adapter name.",
    z.object({}),
    (bound) => {
      const slugs = catalogSlugs.get(bound) ?? {};
      return {
        adapters: Object.keys(bound.webhooks).map((name) => {
          const adapter = bound.getAdapter(name as never) as Adapter;
          return {
            name,
            userName: adapter.userName,
            tools: specs
              .filter((spec) => supports(adapter, spec, slugs[name]))
              .map((spec) => spec.name),
          };
        }),
      };
    },
  );

  if (source) {
    tools.list_bots = server.registerTool(
      "list_bots",
      {
        title: "List bots",
        description:
          "List the bots this server reaches. Every other tool takes one of these ids as bot.",
        inputSchema: z.object({}),
        annotations: DISCOVERY,
      },
      async () => structured({ bots: await source.list() }),
    );
  }

  return tools;
}
