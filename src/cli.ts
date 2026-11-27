#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  localhostHostValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { loadConfig } from "./config";
import { createChatMcpHandler, createChatMcpServer } from "./server";

const command = process.argv[2] ?? "stdio";
if (command !== "stdio" && command !== "http") {
  console.error("Usage: chat-sdk-mcp [stdio|http]");
  process.exit(1);
}
if (command === "stdio") {
  // stdout carries the protocol, so every log goes to stderr.
  console.log = console.info = console.debug = console.error;
}

const PRESET = z.enum(["reader", "messenger", "moderator"]);
const ENV = z.object({
  CHAT_MCP_PRESET: z
    .string()
    .optional()
    .transform((value) => value?.split(",").map((preset) => preset.trim()))
    .pipe(z.array(PRESET).optional()),
  CHAT_MCP_HOST: z.string().default("127.0.0.1"),
  CHAT_MCP_PORT: z.coerce.number().int().positive().default(3000),
  CHAT_MCP_AUTH_TOKEN: z.string().min(16).optional(),
});

const parsed = ENV.safeParse(process.env);
if (!parsed.success) {
  console.error(
    `Invalid chat-sdk-mcp environment:\n${z.prettifyError(parsed.error)}`,
  );
  process.exit(1);
}
const { CHAT_MCP_PRESET, CHAT_MCP_HOST, CHAT_MCP_PORT, CHAT_MCP_AUTH_TOKEN } =
  parsed.data;

const options = {
  ...(await loadConfig().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })),
  preset: CHAT_MCP_PRESET,
};

if (command === "stdio") {
  serveStdio(() => createChatMcpServer(options));
} else {
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(CHAT_MCP_HOST);
  if (!loopback && !CHAT_MCP_AUTH_TOKEN) {
    console.error(
      "Set CHAT_MCP_AUTH_TOKEN to serve on a host other than this machine.",
    );
    process.exit(1);
  }
  const expected =
    CHAT_MCP_AUTH_TOKEN && Buffer.from(`Bearer ${CHAT_MCP_AUTH_TOKEN}`);
  const authorized = (header: string | null) => {
    if (!expected) return true;
    const given = Buffer.from(header ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  const mcp = createChatMcpHandler(options);
  const handle = toNodeHandler({
    fetch: async (request) =>
      authorized(request.headers.get("authorization"))
        ? mcp.fetch(request)
        : new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": "Bearer" },
          }),
  });
  const localhost = loopback ? localhostHostValidation() : undefined;
  createServer((req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (localhost && !localhost(req, res)) return;
    void handle(req, res);
  }).listen(CHAT_MCP_PORT, CHAT_MCP_HOST, () => {
    console.error(
      `chat-sdk-mcp listening on http://${CHAT_MCP_HOST}:${CHAT_MCP_PORT}/mcp`,
    );
  });
}
