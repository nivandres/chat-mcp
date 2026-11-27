import { createMockAdapter, createMockState } from "@chat-adapter/tests";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { type Adapter, Chat } from "chat";
import { describe, expect, it, vi } from "vitest";
import {
  type BotSource,
  type ChatMcpOptions,
  createChatMcpHandler,
  createChatMcpServer,
} from "./index";

type Options = Partial<
  Pick<ChatMcpOptions, "preset" | "scope" | "strictScope">
>;

function chatWith(adapter: Adapter) {
  return new Chat({
    userName: "bot",
    adapters: { slack: adapter },
    state: createMockState(),
  });
}

async function connectTo(options: ChatMcpOptions) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await createChatMcpServer(options).connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function connect(
  options: Options = {},
  overrides: Partial<Adapter> = {},
) {
  const adapter = createMockAdapter("slack", overrides);
  return {
    adapter,
    client: await connectTo({ chat: chatWith(adapter), ...options }),
  };
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  return {
    error: result.isError
      ? (result.content as { text: string }[])
          .map((block) => block.text)
          .join("\n")
      : undefined,
    data: result.structuredContent as Record<string, any>,
    content: result.content,
  };
}

const sent = (threadId: string) => ({ id: "m1", threadId, raw: {} });

describe("createChatMcpServer", () => {
  it("exposes Chat SDK's tools and its own in snake_case, with titles and annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining([
        "fetch_messages",
        "post_message",
        "fetch_message",
        "mark_as_read",
        "open_dm",
        "list_adapters",
      ]),
    );
    expect(Object.keys(byName)).not.toContain("subscribe_thread");
    expect(Object.keys(byName)).not.toContain("list_bots");
    expect(byName.fetch_messages?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(byName.delete_message?.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(byName.post_message?.title).toBe("Post message");
    expect(byName.post_message?.inputSchema.properties).toHaveProperty(
      "replyToMessageId",
    );
    expect(byName.get_user?.inputSchema.properties).toHaveProperty("adapter");
  });

  it("keeps to a Chat SDK preset, its own tools included", async () => {
    const { client } = await connect({ preset: "reader" });
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "fetch_messages",
        "fetch_message",
        "list_adapters",
      ]),
    );
    expect(names).not.toContain("post_message");
    expect(names).not.toContain("mark_as_read");
    expect(names).not.toContain("open_dm");
  });

  it("runs a tool through the adapter and returns its result as structured content and text", async () => {
    const postMessage = vi.fn(async (threadId: string) => sent(threadId));
    const { client } = await connect({}, { postMessage });

    const { data, content } = await call(client, "post_message", {
      threadId: "slack:C1:1",
      message: "hello",
    });

    expect(postMessage).toHaveBeenCalledWith("slack:C1:1", "hello");
    expect(data).toEqual({ messageId: "m1", threadId: "slack:C1:1" });
    expect(content).toEqual([{ type: "text", text: JSON.stringify(data) }]);
  });

  it("returns an adapter's error as a tool error", async () => {
    const { client } = await connect(
      {},
      {
        postMessage: vi.fn(async () =>
          Promise.reject(new Error("Rate limited by slack")),
        ),
      },
    );

    const { error } = await call(client, "post_message", {
      threadId: "slack:C1:1",
      message: "hi",
    });

    expect(error).toContain("Rate limited by slack");
  });

  it("replies to a message when post_message names one", async () => {
    const reply = vi.fn(async (threadId: string) => sent(threadId));
    const postMessage = vi.fn(async (threadId: string) => sent(threadId));
    const { client } = await connect({}, { reply, postMessage });

    const { data } = await call(client, "post_message", {
      threadId: "slack:C1:1",
      message: { markdown: "**yes**" },
      replyToMessageId: "m0",
    });

    expect(reply).toHaveBeenCalled();
    expect(JSON.stringify(reply.mock.calls[0])).toContain("m0");
    expect(postMessage).not.toHaveBeenCalled();
    expect(data).toEqual({ messageId: "m1", threadId: "slack:C1:1" });
  });

  it("says so when the adapter cannot reply", async () => {
    const { client } = await connect({}, { reply: undefined });

    const { error } = await call(client, "post_message", {
      threadId: "slack:C1:1",
      message: "hi",
      replyToMessageId: "m0",
    });

    expect(error).toMatch(/not supported/i);
  });

  it("looks users up and opens DMs on the adapter it is told", async () => {
    const getUser = vi.fn(async (userId: string) => ({
      userId,
      userName: "ana",
      fullName: "Ana",
      isBot: false,
    }));
    const openDM = vi.fn(async (userId: string) => `slack:D-${userId}`);
    const postMessage = vi.fn(async (threadId: string) => sent(threadId));
    const { client } = await connect({}, {
      getUser,
      openDM,
      postMessage,
    } as Partial<Adapter>);

    const user = await call(client, "get_user", {
      userId: "573@c.us",
      adapter: "slack",
    });
    const dm = await call(client, "send_direct_message", {
      userId: "573@c.us",
      adapter: "slack",
      message: "hola",
    });
    const opened = await call(client, "open_dm", {
      userId: "573@c.us",
      adapter: "slack",
    });

    expect(user.data).toEqual({
      user: expect.objectContaining({ userId: "573@c.us", fullName: "Ana" }),
    });
    expect(dm.data).toEqual({ messageId: "m1", threadId: "slack:D-573@c.us" });
    expect(opened.data).toEqual({ threadId: "slack:D-573@c.us" });
    expect(
      (await call(client, "get_user", { userId: "x", adapter: "nope" })).error,
    ).toContain('Unknown adapter "nope"');
  });

  it("keeps Chat SDK's own path when an extended tool gets no extra input", async () => {
    const getUser = vi.fn(async (userId: string) => ({
      userId,
      userName: "ana",
      fullName: "Ana",
      isBot: false,
    }));
    const { client } = await connect({}, { getUser } as Partial<Adapter>);

    const { data, error } = await call(client, "get_user", { userId: "U123" });

    expect(error).toBeUndefined();
    expect(getUser).toHaveBeenCalledWith("U123");
    expect(data).toEqual({ user: expect.objectContaining({ userId: "U123" }) });
  });

  it("wraps a result that can be null under its key", async () => {
    const { client } = await connect({}, { getUser: vi.fn(async () => null) });

    expect(
      (await call(client, "get_user", { userId: "U1", adapter: "slack" })).data,
    ).toEqual({
      user: null,
    });
  });

  it("fetches one message and marks it as read", async () => {
    const fetchMessage = vi.fn(async (threadId: string, id: string) => ({
      id,
      threadId,
      text: "hi",
      author: {
        userId: "U1",
        userName: "ana",
        fullName: "Ana",
        isBot: false,
        isMe: false,
      },
      metadata: { dateSent: new Date(0), edited: false },
      attachments: [],
    }));
    const markAsRead = vi.fn(async (..._args: unknown[]) => undefined);
    const { client } = await connect({}, {
      fetchMessage,
      markAsRead,
    } as unknown as Partial<Adapter>);

    const fetched = await call(client, "fetch_message", {
      threadId: "slack:C1:1",
      messageId: "m9",
    });
    const read = await call(client, "mark_as_read", {
      threadId: "slack:C1:1",
      messageId: "m9",
    });

    expect(fetched.data.message).toMatchObject({
      id: "m9",
      text: "hi",
      author: { userId: "U1" },
      dateSent: "1970-01-01T00:00:00.000Z",
    });
    expect(markAsRead.mock.calls[0]?.slice(0, 2)).toEqual(["slack:C1:1", "m9"]);
    expect(read.data).toEqual({
      read: true,
      threadId: "slack:C1:1",
      messageId: "m9",
    });
  });

  it("keeps Chat SDK's tools and its own to the scope", async () => {
    const postMessage = vi.fn(async (threadId: string) => sent(threadId));
    const { client } = await connect(
      { scope: "slack:C1" },
      { postMessage, reply: postMessage },
    );

    const own = await call(client, "post_message", {
      threadId: "slack:C2:1",
      message: "hi",
      replyToMessageId: "m0",
    });
    const sdk = await call(client, "post_message", {
      threadId: "slack:C2:1",
      message: "hi",
    });
    const inside = await call(client, "post_message", {
      threadId: "slack:C1:9",
      message: "hi",
    });

    expect(own.error).toContain("Tool call blocked");
    expect(sdk.error).toContain("Tool call blocked");
    expect(inside.error).toBeUndefined();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("lists each adapter with the tools it implements", async () => {
    const { client } = await connect(
      {},
      { listThreads: undefined, getUser: undefined },
    );

    const [slack] = (await call(client, "list_adapters")).data.adapters;

    expect(slack.name).toBe("slack");
    expect(slack.tools).toContain("post_message");
    expect(slack.tools).not.toContain("list_threads");
    expect(slack.tools).not.toContain("get_user");
  });
});

describe("several bots", () => {
  it("lists them and routes every call by its bot", async () => {
    const sales = vi.fn(async (threadId: string) => sent(threadId));
    const support = vi.fn(async (threadId: string) => sent(threadId));
    const client = await connectTo({
      bots: {
        sales: chatWith(createMockAdapter("slack", { postMessage: sales })),
        support: chatWith(createMockAdapter("slack", { postMessage: support })),
      },
    });

    const { tools } = await client.listTools();
    await call(client, "post_message", {
      bot: "support",
      threadId: "slack:C1:1",
      message: "hi",
    });

    expect((await call(client, "list_bots")).data).toEqual({
      bots: ["sales", "support"],
    });
    expect(
      tools.find((tool) => tool.name === "post_message")?.inputSchema.required,
    ).toContain("bot");
    expect(support).toHaveBeenCalledOnce();
    expect(sales).not.toHaveBeenCalled();
    expect(
      (
        await call(client, "post_message", {
          bot: "nope",
          threadId: "slack:C1:1",
          message: "hi",
        })
      ).error,
    ).toContain('Unknown bot "nope"');
  });

  it("loads a bot from a source only when a call needs it", async () => {
    const bot = chatWith(createMockAdapter("slack"));
    const source: BotSource = {
      list: () => ["acme"],
      load: vi.fn(async () => bot),
    };
    const client = await connectTo({ bots: source });

    expect(source.load).not.toHaveBeenCalled();
    expect(
      (await call(client, "list_adapters", { bot: "acme" })).data.adapters[0]
        .name,
    ).toBe("slack");
    expect(source.load).toHaveBeenCalledWith("acme");
  });
});

describe("createChatMcpHandler", () => {
  it("serves the tools over Streamable HTTP from any fetch runtime", async () => {
    const handler = createChatMcpHandler({
      chat: chatWith(createMockAdapter("slack")),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );

    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toContain("post_message");
    await client.close();
    await handler.close();
  });
});
