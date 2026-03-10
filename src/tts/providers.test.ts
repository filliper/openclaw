import { describe, expect, it } from "vitest";
import {
  buildTtsProviderRegistry,
  getTtsProvider,
  invalidateTtsProviderCache,
  type TtsProvider,
  type TtsProviderRegistry,
} from "./providers.js";

describe("TtsProviderRegistry", () => {
  describe("buildTtsProviderRegistry", () => {
    it("returns empty registry when no overrides provided", () => {
      const registry = buildTtsProviderRegistry();
      expect(registry.size).toBe(0);
    });

    it("adds providers from overrides", () => {
      const mockProvider: TtsProvider = {
        id: "test",
        textToSpeech: async () => ({ audio: Buffer.from("test"), mime: "audio/mp3" }),
      };
      const registry = buildTtsProviderRegistry({ test: mockProvider });
      expect(registry.get("test")).toBe(mockProvider);
    });

    it("merges overrides with same key", () => {
      const provider1: TtsProvider = {
        id: "test",
        textToSpeech: async () => ({ audio: Buffer.from("test1"), mime: "audio/mp3" }),
      };
      const provider2: TtsProvider = {
        id: "test",
        textToSpeech: async () => ({ audio: Buffer.from("test2"), mime: "audio/mp3" }),
      };
      buildTtsProviderRegistry({ test: provider1 });
      const registry2 = buildTtsProviderRegistry({ test: provider2 });
      expect(registry2.get("test")?.textToSpeech).toBe(provider2.textToSpeech);
    });
  });

  describe("getTtsProvider", () => {
    it("returns provider by exact id", () => {
      const mockProvider: TtsProvider = {
        id: "openai",
        textToSpeech: async () => ({ audio: Buffer.from("test"), mime: "audio/mp3" }),
      };
      const registry = new Map([["openai", mockProvider]]);
      expect(getTtsProvider("openai", registry)).toBe(mockProvider);
    });

    it("looks up by lowercase id", () => {
      const mockProvider: TtsProvider = {
        id: "openai",
        textToSpeech: async () => ({ audio: Buffer.from("test"), mime: "audio/mp3" }),
      };
      const registry = new Map([["openai", mockProvider]]);
      expect(getTtsProvider("OPENAI", registry)).toBe(mockProvider);
      expect(getTtsProvider("OpenAI", registry)).toBe(mockProvider);
    });

    it("returns undefined for unknown provider", () => {
      const registry = new Map<string, TtsProvider>();
      expect(getTtsProvider("unknown", registry)).toBeUndefined();
    });
  });

  describe("cache invalidation", () => {
    it("can build registry after cache invalidation", () => {
      const mockProvider1: TtsProvider = {
        id: "test1",
        textToSpeech: async () => ({ audio: Buffer.from("test1"), mime: "audio/mp3" }),
      };
      const registry1 = buildTtsProviderRegistry({ test1: mockProvider1 });
      expect(registry1.get("test1")).toBe(mockProvider1);

      invalidateTtsProviderCache();

      const registry2 = buildTtsProviderRegistry({});
      expect(registry2.size).toBe(0);
    });
  });
});

describe("getTtsProvider (lowercase lookup)", () => {
  it("normalizes provider ID to lowercase on lookup", () => {
    const mockProvider: TtsProvider = {
      id: "custom",
      textToSpeech: async () => ({ audio: Buffer.from("test"), mime: "audio/mp3" }),
    };
    const registry: TtsProviderRegistry = new Map([["custom", mockProvider]]);

    expect(getTtsProvider("CUSTOM", registry)).toBe(mockProvider);
    expect(getTtsProvider("Custom", registry)).toBe(mockProvider);
    expect(getTtsProvider("custom", registry)).toBe(mockProvider);
  });
});
