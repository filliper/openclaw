import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { parseModelRef } from "../agents/model-selection.js";
import type { OpenClawConfig } from "../config/config.js";

export function applyVllmDefaultModel(cfg: OpenClawConfig, modelRef: string): OpenClawConfig {
  const existingModel = cfg.agents?.defaults?.model;
  const fallbacks =
    existingModel && typeof existingModel === "object" && "fallbacks" in existingModel
      ? (existingModel as { fallbacks?: string[] }).fallbacks
      : undefined;

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        model: {
          ...(fallbacks ? { fallbacks } : undefined),
          primary: modelRef,
        },
      },
    },
  };
}

function isManagedVllmProvider(provider: string): boolean {
  return provider === "vllm" || provider.startsWith("vllm-");
}

export function clearStaleVllmDefaultModel(cfg: OpenClawConfig): OpenClawConfig {
  const defaultModel = cfg.agents?.defaults?.model;
  if (!defaultModel) {
    return cfg;
  }

  const primaryRaw =
    typeof defaultModel === "string"
      ? defaultModel
      : typeof defaultModel === "object" && "primary" in defaultModel
        ? defaultModel.primary
        : undefined;
  const parsed = primaryRaw ? parseModelRef(primaryRaw, DEFAULT_PROVIDER) : null;
  if (!parsed || !isManagedVllmProvider(parsed.provider)) {
    return cfg;
  }
  if (cfg.models?.providers?.[parsed.provider]) {
    return cfg;
  }

  const defaults = { ...cfg.agents?.defaults };
  if (typeof defaultModel === "object" && "fallbacks" in defaultModel) {
    const fallbacks = Array.isArray(defaultModel.fallbacks) ? defaultModel.fallbacks : [];
    const [nextPrimary, ...remainingFallbacks] = fallbacks;
    if (nextPrimary) {
      defaults.model = {
        ...(remainingFallbacks.length > 0 ? { fallbacks: remainingFallbacks } : {}),
        primary: nextPrimary,
      };
    } else {
      delete defaults.model;
    }
  } else {
    delete defaults.model;
  }

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults,
    },
  };
}
