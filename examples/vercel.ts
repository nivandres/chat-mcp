// app/api/mcp/route.ts in a Next.js app on Vercel.
import type { Chat } from "chat";
import { createChatMcpHandler } from "chat-sdk-mcp";

declare const bot: Chat;

const mcp = createChatMcpHandler({ chat: bot });

export async function POST(request: Request): Promise<Response> {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.MCP_TOKEN}`
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  return mcp.fetch(request);
}
