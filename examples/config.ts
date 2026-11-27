import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createChatMcpServer } from "chat-mcp";
import { loadConfig } from "chat-mcp/config";

const options = await loadConfig("./chat-mcp.json");

serveStdio(() => createChatMcpServer({ ...options, preset: "reader" }));
