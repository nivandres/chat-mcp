import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createChatMcpServer } from "chat-sdk-mcp";
import { loadConfig } from "chat-sdk-mcp/config";

const options = await loadConfig("./chat-sdk-mcp.json");

serveStdio(() => createChatMcpServer({ ...options, preset: "reader" }));
