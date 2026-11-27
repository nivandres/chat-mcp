import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { createChatMcpServer } from "./server";

const ADAPTER = fileURLToPath(new URL("./testing/adapter.ts", import.meta.url));
const BOT = fileURLToPath(new URL("./testing/bot.ts", import.meta.url));
const entry = (config: Record<string, unknown> = {}, slug?: string) => ({
  slug,
  importPath: ADAPTER,
  factoryExport: "createTestAdapter",
  config,
});

describe("loadConfig", () => {
  it("builds a Chat from inline JSON, reading ${VAR} and ${VAR:-default}", async () => {
    const options = await loadConfig(
      JSON.stringify({
        adapters: {
          test: entry({ token: "${TEST_TOKEN}", name: "${TEST_NAME:-test}" }),
        },
        userName: "helper",
      }),
      { TEST_TOKEN: "secret" },
    );

    const adapter = options.chat?.getAdapter("test" as never) as unknown as {
      token: string;
    };
    expect(adapter.token).toBe("secret");
  });

  it("refuses a variable that is not set", async () => {
    await expect(
      loadConfig({ adapters: { test: entry({ token: "${MISSING}" }) } }, {}),
    ).rejects.toThrow("${MISSING} in adapters.test.config.token is not set.");
  });

  it("names the package to install for a catalog adapter that is missing", async () => {
    await expect(
      loadConfig(undefined, { CHAT_MCP_ADAPTERS: "slack" }),
    ).rejects.toThrow(
      'Adapter "slack" needs @chat-adapter/slack (with @slack/socket-mode, @slack/web-api). Install it next to chat-mcp.',
    );
  });

  it("refuses an adapter the catalog does not know and no package names", async () => {
    await expect(
      loadConfig(undefined, { CHAT_MCP_ADAPTERS: "slakc" }),
    ).rejects.toThrow('Adapter "slakc" is not in the Chat SDK catalog');
    await expect(loadConfig(undefined, {})).rejects.toThrow(
      "No adapters configured",
    );
  });

  it("asks for a factory a community adapter's catalog entry lacks", async () => {
    await expect(loadConfig({ adapters: { baileys: {} } }, {})).rejects.toThrow(
      'Adapter "baileys" (chat-adapter-baileys) has no factory in the Chat SDK catalog',
    );
  });

  it("refuses an adapter keyed under another name than its own", async () => {
    await expect(
      loadConfig({ adapters: { work: entry() } }, {}),
    ).rejects.toThrow('Adapter "work" is named "test" by its package');
  });

  it("explains an invalid config", async () => {
    await expect(
      loadConfig({ adapters: {}, extra: true } as never, {}),
    ).rejects.toThrow("Invalid chat-mcp config");
  });

  it("builds several bots, each from its own config", async () => {
    const options = await loadConfig(
      {
        bots: {
          sales: { adapters: { test: entry() } },
          support: { adapters: { test: entry() } },
        },
      },
      {},
    );

    expect(Object.keys(options.bots ?? {})).toEqual(["sales", "support"]);
  });

  it("loads a module that exports the project's bot", async () => {
    const options = await loadConfig(undefined, { CHAT_MCP_CONFIG: BOT });

    expect(options.chat?.getAdapter("slack" as never)).toBeDefined();
  });

  it("hides the tools the catalog says an adapter lacks, for adapters it built", async () => {
    const options = await loadConfig(
      { adapters: { telegram: entry({ name: "telegram" }, "telegram") } },
      {},
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await createChatMcpServer(options).connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "list_adapters",
      arguments: {},
    });
    const [telegram] = (
      result.structuredContent as { adapters: { tools: string[] }[] }
    ).adapters;

    expect(telegram?.tools).toContain("post_message");
    expect(telegram?.tools).not.toContain("list_threads");
  });
});
