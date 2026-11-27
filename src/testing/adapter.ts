import { createMockAdapter } from "@chat-adapter/tests";

/** A factory shaped like a catalog adapter's, for config tests. */
export function createTestAdapter(
  config: { name?: string; token?: string } = {},
) {
  return Object.assign(
    createMockAdapter(config.name ?? "test", {
      listThreads: async () => ({ threads: [] }),
    }),
    { token: config.token },
  );
}
