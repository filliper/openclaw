import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  baseTelegramMessageContextConfig,
  buildTelegramMessageContextForTest,
} from "./bot-message-context.test-harness.js";

// Mock recordInboundSession to capture session key
const recordInboundSessionMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../channels/session.js", () => ({
  recordInboundSession: (...args: unknown[]) => recordInboundSessionMock(...args),
}));

describe("Telegram DM session isolation (#41165)", () => {
  beforeEach(() => {
    recordInboundSessionMock.mockClear();
  });

  it("does not route Telegram DMs to agent:main:main when dmScope is main (default)", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        chat: { id: 7463849194, type: "private" },
        from: { id: 7463849194, first_name: "Alice" },
        text: "hello",
      },
    });

    // Context should exist (DM not blocked)
    expect(ctx).toBeTruthy();
    if (!ctx) {
      return;
    }

    // Session key should NOT be agent:main:main — it should be isolated
    const sessionKey = ctx.ctxPayload.SessionKey;
    expect(sessionKey).not.toBe("agent:main:main");
    // Should include telegram:direct to isolate from heartbeat/internal traffic
    expect(sessionKey).toContain("telegram");
    expect(sessionKey).toContain("direct");
  });

  it("preserves per-peer isolation when dmScope is per-peer", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        chat: { id: 7463849194, type: "private" },
        from: { id: 7463849194, first_name: "Alice" },
        text: "hello",
      },
      cfg: {
        ...baseTelegramMessageContextConfig,
        session: { dmScope: "per-peer" },
      },
    });

    expect(ctx).toBeTruthy();
    if (!ctx) {
      return;
    }

    const sessionKey = ctx.ctxPayload.SessionKey;
    expect(sessionKey).not.toBe("agent:main:main");
    expect(sessionKey).toContain("direct");
  });

  it("preserves per-channel-peer isolation when dmScope is per-channel-peer", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        chat: { id: 7463849194, type: "private" },
        from: { id: 7463849194, first_name: "Alice" },
        text: "hello",
      },
      cfg: {
        ...baseTelegramMessageContextConfig,
        session: { dmScope: "per-channel-peer" },
      },
    });

    expect(ctx).toBeTruthy();
    if (!ctx) {
      return;
    }

    const sessionKey = ctx.ctxPayload.SessionKey;
    expect(sessionKey).not.toBe("agent:main:main");
    expect(sessionKey).toContain("telegram");
    expect(sessionKey).toContain("direct");
  });

  it("does not affect group routing", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        chat: { id: -100123456, type: "supergroup", title: "Test Group" },
        from: { id: 42, first_name: "Alice" },
        text: "hello",
      },
    });

    expect(ctx).toBeTruthy();
    if (!ctx) {
      return;
    }

    // Group session key should contain the group peer id
    const sessionKey = ctx.ctxPayload.SessionKey;
    expect(sessionKey).toContain("group");
  });
});
