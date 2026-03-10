import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { promptDefaultModel } from "./model-picker.js";
import { makePrompter } from "./onboarding/__tests__/test-utils.js";

const loadModelCatalog = vi.hoisted(() => vi.fn());
const promptAndConfigureVllm = vi.hoisted(() => vi.fn());
const ensureAuthProfileStore = vi.hoisted(() =>
  vi.fn(() => ({
    version: 1,
    profiles: {},
  })),
);
const listProfilesForProvider = vi.hoisted(() => vi.fn(() => []));
const resolveEnvApiKey = vi.hoisted(() => vi.fn(() => undefined));
const getCustomProviderApiKey = vi.hoisted(() => vi.fn(() => undefined));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog,
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore,
  listProfilesForProvider,
}));

vi.mock("../agents/model-auth.js", () => ({
  resolveEnvApiKey,
  getCustomProviderApiKey,
}));

vi.mock("./vllm-setup.js", () => ({
  promptAndConfigureVllm,
}));

describe("promptDefaultModel vLLM cleanup", () => {
  it("clears a stale vLLM default when setup exits with config-only changes", async () => {
    loadModelCatalog.mockResolvedValue([
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
      },
    ]);
    promptAndConfigureVllm.mockResolvedValue({
      config: {
        agents: {
          defaults: {
            model: {
              primary: "vllm/model-a",
              fallbacks: ["anthropic/claude-sonnet-4-5"],
            },
          },
        },
        models: {
          providers: {},
        },
      } satisfies OpenClawConfig,
    });

    const select = vi.fn(async (params) => {
      const vllm = params.options.find((opt: { value: string }) => opt.value === "__vllm__");
      return (vllm?.value ?? "") as never;
    });
    const result = await promptDefaultModel({
      config: { agents: { defaults: {} } } as OpenClawConfig,
      prompter: makePrompter({ select }),
      allowKeep: false,
      includeManual: false,
      includeVllm: true,
      ignoreAllowlist: true,
      agentDir: "/tmp/openclaw-agent",
    });

    expect(result).toEqual({
      config: {
        agents: {
          defaults: {
            model: {
              primary: "anthropic/claude-sonnet-4-5",
            },
          },
        },
        models: {
          providers: {},
        },
      },
    });
  });
});
