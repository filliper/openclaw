import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";

async function invalidatePluginCaches(): Promise<void> {
  try {
    const { invalidateTtsProviderCache } = await import("../tts/providers.js");
    invalidateTtsProviderCache();
  } catch {
    // TTS providers may not be available in all contexts
  }
  try {
    const { invalidateMediaProviderCache } =
      await import("../media-understanding/providers/index.js");
    invalidateMediaProviderCache();
  } catch {
    // media providers may not be available in all contexts
  }
}

const REGISTRY_STATE = Symbol.for("openclaw.pluginRegistryState");

type RegistryState = {
  registry: PluginRegistry | null;
  key: string | null;
  version: number;
};

const state: RegistryState = (() => {
  const globalState = globalThis as typeof globalThis & {
    [REGISTRY_STATE]?: RegistryState;
  };
  if (!globalState[REGISTRY_STATE]) {
    globalState[REGISTRY_STATE] = {
      registry: createEmptyPluginRegistry(),
      key: null,
      version: 0,
    };
  }
  return globalState[REGISTRY_STATE];
})();

export function setActivePluginRegistry(registry: PluginRegistry, cacheKey?: string) {
  state.registry = registry;
  state.key = cacheKey ?? null;
  state.version += 1;
  // Chain invalidation and population to avoid race conditions
  void invalidatePluginCaches().then(() => populateMediaProviderCaches());
}

async function populateMediaProviderCaches(): Promise<void> {
  try {
    const { buildMediaUnderstandingRegistryAsync } =
      await import("../media-understanding/providers/index.js");
    await buildMediaUnderstandingRegistryAsync();
  } catch {
    // Media providers may not be available
  }
  try {
    const { buildTtsProviderRegistryAsync } = await import("../tts/providers.js");
    await buildTtsProviderRegistryAsync();
  } catch {
    // TTS providers may not be available
  }
}

export function getActivePluginRegistry(): PluginRegistry | null {
  return state.registry;
}

export function requireActivePluginRegistry(): PluginRegistry {
  if (!state.registry) {
    state.registry = createEmptyPluginRegistry();
    state.version += 1;
    void invalidatePluginCaches();
  }
  return state.registry;
}

export function getActivePluginRegistryKey(): string | null {
  return state.key;
}

export function getActivePluginRegistryVersion(): number {
  return state.version;
}
