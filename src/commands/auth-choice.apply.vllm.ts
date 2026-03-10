import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyVllmDefaultModel, clearStaleVllmDefaultModel } from "./vllm-default-model.js";
import { promptAndConfigureVllm } from "./vllm-setup.js";

export async function applyAuthChoiceVllm(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "vllm") {
    return null;
  }

  const vllmSelection = await promptAndConfigureVllm({
    cfg: params.config,
    prompter: params.prompter,
    agentDir: params.agentDir,
  });

  if (!vllmSelection.modelRef) {
    return {
      config: clearStaleVllmDefaultModel(vllmSelection.config),
      clearAgentModelOverride: true,
    };
  }

  const { config: nextConfig, modelRef } = vllmSelection;

  if (!params.setDefaultModel) {
    return { config: nextConfig, agentModelOverride: modelRef };
  }

  await params.prompter.note(`Default model set to ${modelRef}`, "Model configured");
  return { config: applyVllmDefaultModel(nextConfig, modelRef) };
}
