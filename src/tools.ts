import type { PlatformFeatureKey } from "@chat-adapter/catalog";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { Adapter, Message, UserInfo } from "chat";
import type {
  ChatBinding,
  ChatToolName,
  ChatToolPreset,
} from "chat/ai/tanstack";
import { z } from "zod";
import type { Guard } from "./scope";

export const DISCOVERY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
const ACTION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};
const IDEMPOTENT: ToolAnnotations = { ...ACTION, idempotentHint: true };
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export interface ToolSpec {
  annotations: ToolAnnotations;
  /** The catalog feature an adapter needs for the tool to work. */
  feature?: PlatformFeatureKey;
  /** The optional adapter method the tool calls. */
  method?: keyof Adapter;
  name: string;
  title: string;
}

/** Inputs chat-sdk-mcp adds to one of Chat SDK's tools, and how it answers when they are given. */
export interface Extension {
  input: z.ZodRawShape;
  run(
    chat: ChatBinding,
    input: Record<string, unknown>,
    guard: Guard,
  ): Promise<unknown> | undefined;
}

/** A tool chat-sdk-mcp defines itself, for what Chat SDK's toolset leaves out. */
export interface OwnTool extends ToolSpec {
  description: string;
  input: z.ZodObject;
  presets: ChatToolPreset[];
  run(chat: ChatBinding, input: never, guard: Guard): Promise<unknown>;
}

type PostableInput = string | { markdown: string } | { raw: string };

function toPostable(input: PostableInput) {
  if (typeof input === "string") return input;
  return "markdown" in input
    ? { markdown: input.markdown, aiGenerated: true }
    : { raw: input.raw, aiGenerated: true };
}

function adapterOf(chat: ChatBinding, id: string): Adapter {
  return chat.getAdapter(id.split(":")[0] as never) as Adapter;
}

function adapterNamed(chat: ChatBinding, name: string): Adapter {
  const adapter = chat.getAdapter(name as never) as Adapter | undefined;
  if (!adapter)
    throw new Error(
      `Unknown adapter "${name}". Call list_adapters for the adapter names.`,
    );
  return adapter;
}

function unsupported(adapter: Adapter, tool: string): never {
  throw new Error(
    `${adapter.name} does not support ${tool}. Call list_adapters for the tools each adapter supports.`,
  );
}

function projectUser(user: UserInfo) {
  return {
    userId: user.userId,
    userName: user.userName,
    fullName: user.fullName,
    email: user.email,
    isBot: user.isBot,
    avatarUrl: user.avatarUrl,
  };
}

function projectMessage(message: Message) {
  return {
    id: message.id,
    threadId: message.threadId,
    text: message.text,
    author: {
      userId: message.author.userId,
      userName: message.author.userName,
      fullName: message.author.fullName,
      isBot: message.author.isBot,
      isMe: message.author.isMe,
    },
    dateSent: message.metadata.dateSent?.toISOString(),
    edited: message.metadata.edited,
    isMention: message.isMention,
    attachments: (message.attachments ?? []).map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      url: attachment.url,
    })),
  };
}

const ADAPTER_INPUT = z
  .string()
  .optional()
  .describe(
    "Adapter the user belongs to, as list_adapters names it. Needed when Chat SDK cannot tell it from the user id.",
  );

/** Chat SDK's tools, in its order, as they are exposed over MCP; its thread subscriptions are left out, since they change how a live bot answers. */
export const CHAT_TOOLS = {
  fetchMessages: {
    name: "fetch_messages",
    title: "Fetch messages",
    annotations: READ_ONLY,
    feature: "fetchMessages",
  },
  fetchChannelMessages: {
    name: "fetch_channel_messages",
    title: "Fetch channel messages",
    annotations: READ_ONLY,
    method: "fetchChannelMessages",
    feature: "fetchChannelMessages",
  },
  fetchThread: {
    name: "fetch_thread",
    title: "Fetch thread",
    annotations: READ_ONLY,
    feature: "fetchThreadInfo",
  },
  listThreads: {
    name: "list_threads",
    title: "List threads",
    annotations: READ_ONLY,
    method: "listThreads",
    feature: "listThreads",
  },
  getThreadParticipants: {
    name: "get_thread_participants",
    title: "Get thread participants",
    annotations: READ_ONLY,
    feature: "fetchMessages",
  },
  getChannelInfo: {
    name: "get_channel_info",
    title: "Get channel info",
    annotations: READ_ONLY,
  },
  getUser: {
    name: "get_user",
    title: "Get user",
    annotations: READ_ONLY,
    method: "getUser",
    feature: "userLookup",
  },
  startTyping: {
    name: "start_typing",
    title: "Start typing",
    annotations: IDEMPOTENT,
    feature: "typingIndicator",
  },
  postMessage: {
    name: "post_message",
    title: "Post message",
    annotations: ACTION,
    feature: "postMessage",
  },
  postChannelMessage: {
    name: "post_channel_message",
    title: "Post channel message",
    annotations: ACTION,
    feature: "postChannelMessage",
  },
  sendDirectMessage: {
    name: "send_direct_message",
    title: "Send direct message",
    annotations: ACTION,
    method: "openDM",
    feature: "directMessages",
  },
  editMessage: {
    name: "edit_message",
    title: "Edit message",
    annotations: DESTRUCTIVE,
    feature: "editMessage",
  },
  deleteMessage: {
    name: "delete_message",
    title: "Delete message",
    annotations: DESTRUCTIVE,
    feature: "deleteMessage",
  },
  addReaction: {
    name: "add_reaction",
    title: "Add reaction",
    annotations: IDEMPOTENT,
    feature: "addReactions",
  },
  removeReaction: {
    name: "remove_reaction",
    title: "Remove reaction",
    annotations: DESTRUCTIVE,
    feature: "removeReactions",
  },
} as const satisfies Partial<Record<ChatToolName, ToolSpec>>;

/** Results that can be null, wrapped under a key so every result is an object. */
export const RESULT_KEYS: Partial<Record<ChatToolName, string>> = {
  getUser: "user",
};

export const EXTENSIONS: Partial<Record<ChatToolName, Extension>> = {
  postMessage: {
    input: {
      replyToMessageId: z
        .string()
        .optional()
        .describe(
          "Id of a message in the thread to reply to, quoting it where the platform supports replies",
        ),
    },
    run(chat, { threadId, message, replyToMessageId }, guard) {
      if (typeof replyToMessageId !== "string") return undefined;
      const id = threadId as string;
      guard(id);
      return chat
        .thread(id)
        .reply(replyToMessageId, toPostable(message as PostableInput))
        .then((sent) => ({ messageId: sent.id, threadId: sent.threadId }));
    },
  },
  getUser: {
    input: { adapter: ADAPTER_INPUT },
    async run(chat, { userId, adapter }) {
      if (typeof adapter !== "string") return undefined;
      const target = adapterNamed(chat, adapter);
      if (!target.getUser) unsupported(target, "get_user");
      const user = await target.getUser(userId as string);
      return { user: user && projectUser(user) };
    },
  },
  sendDirectMessage: {
    input: { adapter: ADAPTER_INPUT },
    async run(chat, { userId, message, adapter }) {
      if (typeof adapter !== "string") return undefined;
      const target = adapterNamed(chat, adapter);
      if (!target.openDM) unsupported(target, "send_direct_message");
      const sent = await chat
        .thread(await target.openDM(userId as string))
        .post(toPostable(message as PostableInput));
      return { messageId: sent.id, threadId: sent.threadId };
    },
  },
};

const MESSAGE_INPUT = z.object({
  threadId: z.string().describe("Full thread id including adapter prefix"),
  messageId: z.string().describe("Platform message id"),
});

export const OWN_TOOLS = [
  {
    name: "fetch_message",
    title: "Fetch message",
    description:
      "Fetch one message of a thread by its id. Returns null if the platform no longer has it.",
    annotations: READ_ONLY,
    method: "fetchMessage",
    feature: "fetchSingleMessage",
    presets: ["reader", "messenger", "moderator"],
    input: MESSAGE_INPUT,
    async run(
      chat: ChatBinding,
      { threadId, messageId }: z.infer<typeof MESSAGE_INPUT>,
      guard,
    ) {
      guard(threadId);
      const adapter = adapterOf(chat, threadId);
      if (!adapter.fetchMessage) unsupported(adapter, "fetch_message");
      const message = await adapter.fetchMessage(threadId, messageId);
      return { message: message && projectMessage(message) };
    },
  },
  {
    name: "mark_as_read",
    title: "Mark as read",
    description:
      "Mark a message as read by the bot. Some platforms mark the whole conversation instead.",
    annotations: IDEMPOTENT,
    method: "markAsRead",
    feature: "markAsRead",
    presets: ["messenger", "moderator"],
    input: MESSAGE_INPUT,
    async run(
      chat: ChatBinding,
      { threadId, messageId }: z.infer<typeof MESSAGE_INPUT>,
      guard,
    ) {
      guard(threadId);
      await chat.thread(threadId).markAsRead(messageId);
      return { read: true, threadId, messageId };
    },
  },
  {
    name: "open_dm",
    title: "Open DM",
    description:
      "Open the direct-message thread with a user and return its thread id, to read it or post to it.",
    annotations: IDEMPOTENT,
    method: "openDM",
    feature: "directMessages",
    presets: ["messenger", "moderator"],
    input: z.object({
      userId: z.string().describe("Platform-specific user id"),
      adapter: ADAPTER_INPUT,
    }),
    async run(
      chat: ChatBinding,
      { userId, adapter }: { userId: string; adapter?: string },
    ) {
      if (adapter === undefined)
        return { threadId: (await chat.openDM(userId)).id };
      const target = adapterNamed(chat, adapter);
      if (!target.openDM) unsupported(target, "open_dm");
      return { threadId: await target.openDM(userId) };
    },
  },
] as const satisfies readonly OwnTool[];

/** The name of every tool chat-sdk-mcp registers. */
export type ChatMcpToolName =
  | (typeof CHAT_TOOLS)[keyof typeof CHAT_TOOLS]["name"]
  | (typeof OWN_TOOLS)[number]["name"]
  | "list_adapters"
  | "list_bots";
