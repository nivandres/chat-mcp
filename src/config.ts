import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getCatalogEntry } from "@chat-adapter/catalog";
import { Chat, type Adapter, type StateAdapter } from "chat";
import type { ChatBinding } from "chat/ai/tanstack";
import { z } from "zod";
import { type ChatMcpOptions, catalogSlugs } from "./register";

type Env = Record<string, string | undefined>;

const ENTRY = z.strictObject({
  slug: z.string().optional(),
  packageName: z.string().optional(),
  importPath: z.string().optional(),
  factoryExport: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const CHAT = z.strictObject({
  adapters: z.record(z.string(), ENTRY),
  state: ENTRY.optional(),
  userName: z.string().optional(),
  logger: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),
});

const CONFIG = z.union([
  CHAT,
  z.strictObject({ bots: z.record(z.string(), CHAT) }),
]);

/** An adapter or state adapter: a catalog slug, or a package and its factory, called with `config`. */
export type AdapterEntry = z.infer<typeof ENTRY>;

/** One bot: a JSON form of `new Chat({ adapters, state, userName, logger })`. */
export type ChatConfig = z.infer<typeof CHAT>;

/** The JSON configuration: one bot, or several by id. */
export type ChatMcpConfig = z.infer<typeof CONFIG>;

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

function expand(value: unknown, env: Env, path: string): unknown {
  if (typeof value === "string") {
    return value.replace(VARIABLE, (_, name: string, fallback?: string) => {
      const found = env[name] ?? fallback;
      if (found === undefined)
        throw new Error(`\${${name}} in ${path} is not set.`);
      return found;
    });
  }
  if (Array.isArray(value))
    return value.map((item, index) => expand(item, env, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expand(item, env, `${path}.${key}`),
      ]),
    );
  }
  return value;
}

async function build<T>(
  key: string,
  entry: AdapterEntry,
  env: Env,
  path: string,
): Promise<T> {
  const catalog = getCatalogEntry(entry.slug ?? key);
  const setup = catalog && "factoryExport" in catalog ? catalog : undefined;
  const specifier =
    entry.importPath ??
    entry.packageName ??
    setup?.importPath ??
    catalog?.packageName;
  if (!specifier) {
    throw new Error(
      `Adapter "${key}" is not in the Chat SDK catalog. Use a catalog slug such as slack, or set packageName and factoryExport.`,
    );
  }
  const factoryExport = entry.factoryExport ?? setup?.factoryExport;
  if (!factoryExport) {
    throw new Error(
      `Adapter "${key}" (${specifier}) has no factory in the Chat SDK catalog. Set factoryExport, such as "createWWebJSAdapter".`,
    );
  }
  const module: Record<string, unknown> = await import(specifier).catch(
    (error: unknown) => {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND")
        throw error;
      const peers = setup?.peerDeps?.length
        ? ` (with ${setup.peerDeps.join(", ")})`
        : "";
      throw new Error(
        `Adapter "${key}" needs ${specifier}${peers}. Install it next to chat-mcp.`,
      );
    },
  );
  const factory = module[factoryExport];
  if (typeof factory !== "function") {
    throw new Error(`${specifier} has no ${factoryExport} export.`);
  }
  return factory(expand(entry.config, env, `${path}.config`)) as T;
}

async function chatFrom(
  config: ChatConfig,
  env: Env,
  path: string,
): Promise<ChatBinding> {
  const adapters: Record<string, Adapter> = {};
  const slugs: Record<string, string> = {};
  for (const [key, entry] of Object.entries(config.adapters)) {
    const adapter = await build<Adapter>(
      key,
      entry,
      env,
      `${path}adapters.${key}`,
    );
    if (adapter.name !== key) {
      throw new Error(
        `Adapter "${key}" is named "${adapter.name}" by its package; key it as "${adapter.name}", or set its name in config.`,
      );
    }
    adapters[key] = adapter;
    slugs[key] = entry.slug ?? key;
  }
  const chat = new Chat({
    userName: config.userName ?? env.BOT_USERNAME ?? "chat-mcp",
    logger: config.logger,
    adapters,
    state: await build<StateAdapter>(
      "memory",
      config.state ?? {},
      env,
      `${path}state`,
    ),
  });
  catalogSlugs.set(chat, slugs);
  return chat;
}

type Read = { options: ChatMcpOptions } | { config: unknown };

async function read(source: string): Promise<Read> {
  const text = source.trim();
  if (text.startsWith("{")) return { config: JSON.parse(text) };
  const path = resolve(text);
  if (!/\.(c|m)?(j|t)s$/.test(path)) {
    return { config: JSON.parse(await readFile(path, "utf8")) };
  }
  const module = (await import(pathToFileURL(path).href)) as Record<
    string,
    unknown
  >;
  const exported = module.default ?? module.bot;
  if (!exported || typeof exported !== "object") {
    throw new Error(`${text} exports no Chat: export it as default or as bot.`);
  }
  return {
    options:
      typeof (exported as Partial<ChatBinding>).initialize === "function"
        ? { chat: exported as ChatBinding }
        : { bots: exported as Record<string, ChatBinding> },
  };
}

function fromEnv(env: Env): ChatMcpConfig {
  if (env.CHAT_MCP_CONFIG && env.CHAT_MCP_ADAPTERS) {
    throw new Error("Set CHAT_MCP_CONFIG or CHAT_MCP_ADAPTERS, not both.");
  }
  const slugs = env.CHAT_MCP_ADAPTERS?.split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (!slugs?.length) {
    throw new Error(
      "No adapters configured. Set CHAT_MCP_ADAPTERS (such as slack,telegram) or CHAT_MCP_CONFIG.",
    );
  }
  return {
    adapters: Object.fromEntries(slugs.map((slug) => [slug, {}])),
    state: env.CHAT_MCP_STATE ? { slug: env.CHAT_MCP_STATE } : undefined,
  };
}

/**
 * Builds the `Chat` instances `createChatMcpServer` takes, from a JSON file, inline
 * JSON, a module exporting your bot, a config object or, with no source, the
 * environment (`CHAT_MCP_CONFIG`, else `CHAT_MCP_ADAPTERS`). Adapters come from
 * the Chat SDK catalog and read their own variables unless `config` sets them;
 * `${VAR}` and `${VAR:-default}` in `config` read the environment.
 *
 * @example
 * ```ts
 * const server = createChatMcpServer(await loadConfig("./chat-mcp.json"));
 * ```
 */
export async function loadConfig(
  source?: string | ChatMcpConfig,
  env: Env = process.env,
): Promise<ChatMcpOptions> {
  const input: Read =
    typeof source === "string"
      ? await read(source)
      : source
        ? { config: source }
        : env.CHAT_MCP_CONFIG
          ? await read(env.CHAT_MCP_CONFIG)
          : { config: fromEnv(env) };
  if ("options" in input) return input.options;
  const parsed = CONFIG.safeParse(input.config);
  if (!parsed.success) {
    throw new Error(
      `Invalid chat-mcp config:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const config = parsed.data;
  if (!("bots" in config)) return { chat: await chatFrom(config, env, "") };
  const bots: Record<string, ChatBinding> = {};
  for (const [id, bot] of Object.entries(config.bots)) {
    bots[id] = await chatFrom(bot, env, `bots.${id}.`);
  }
  return { bots };
}
