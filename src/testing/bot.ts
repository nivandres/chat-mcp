import { createMockAdapter, createMockState } from "@chat-adapter/tests";
import { Chat } from "chat";

export const bot = new Chat({
  userName: "bot",
  adapters: { slack: createMockAdapter("slack") },
  state: createMockState(),
});
