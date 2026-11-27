import type { ChatBinding, ReadScope } from "chat/ai/tanstack";

export type Guard = (id: string) => void;

function channelOf(chat: ChatBinding, id: string): string {
  const adapter = chat.getAdapter(id.split(":")[0] as never) as
    { channelIdFromThreadId?: (threadId: string) => string } | undefined;
  return (
    adapter?.channelIdFromThreadId?.(id) ?? id.split(":").slice(0, 2).join(":")
  );
}

/** Chat SDK's scope check for an explicit `scope`, for chat-sdk-mcp's own paths; MCP calls never run inside a bot handler, so there is no active conversation to fall back to. */
export function guardFor(
  chat: ChatBinding,
  scope: ReadScope | false | undefined,
  strict = false,
): Guard {
  if (!scope) return () => undefined;
  const scoped = typeof scope === "string" ? scope : scope.id;
  const scopedChannel = channelOf(chat, scoped);
  return (id) => {
    const inScope =
      channelOf(chat, id) === scopedChannel &&
      (!strict || scoped === scopedChannel || id === scoped);
    if (!inScope) {
      throw new Error(
        `Tool call blocked: tools are scoped to "${scoped}", but "${id}" resolves outside it.`,
      );
    }
  };
}
