import { McpServer } from "@modelcontextprotocol/server";
import type { Chat } from "chat";
import { CHAT_MCP_INSTRUCTIONS, registerChatTools } from "chat-mcp";
import { z } from "zod";

declare const bot: Chat;

const server = new McpServer(
  { name: "my-app", version: "1.0.0" },
  { instructions: `${CHAT_MCP_INSTRUCTIONS} Use get_order for order details.` },
);

const tools = registerChatTools(server, {
  chat: bot,
  preset: ["reader", "messenger"],
});
tools.post_message?.update({
  description: "Reply in a customer conversation.",
});

server.registerTool(
  "get_order",
  {
    description: "Get an order by its id.",
    inputSchema: z.object({ orderId: z.string() }),
  },
  async ({ orderId }) => ({
    content: [{ type: "text", text: `Order ${orderId}` }],
  }),
);
