import type { AgentMessage } from "@mariozechner/pi-agent-core";

export const BOILERPLATE_REPLY_TEXT = new Set(["HEARTBEAT_OK", "NO_REPLY"]);
export const TOOL_RESULT_REAL_CONVERSATION_LOOKBACK = 20;
const TOOL_ONLY_BLOCK_TYPES = new Set(["toolCall", "toolUse", "functionCall"]);

export function hasMeaningfulConversationContent(message: AgentMessage): boolean {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) {
      return false;
    }
    return !BOILERPLATE_REPLY_TEXT.has(trimmed);
  }
  if (!Array.isArray(content)) {
    return false;
  }
  let sawMeaningfulNonTextBlock = false;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const type = (block as { type?: unknown }).type;
    if (type !== "text") {
      if (typeof type === "string" && TOOL_ONLY_BLOCK_TYPES.has(type)) {
        continue;
      }
      sawMeaningfulNonTextBlock = true;
      continue;
    }
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") {
      continue;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    if (!BOILERPLATE_REPLY_TEXT.has(trimmed)) {
      return true;
    }
  }
  return sawMeaningfulNonTextBlock;
}

export function isRealConversationMessage(
  message: AgentMessage,
  messages: AgentMessage[],
  index: number,
): boolean {
  if (message.role === "user" || message.role === "assistant") {
    return hasMeaningfulConversationContent(message);
  }
  if (message.role !== "toolResult") {
    return false;
  }
  const start = Math.max(0, index - TOOL_RESULT_REAL_CONVERSATION_LOOKBACK);
  for (let i = index - 1; i >= start; i -= 1) {
    const candidate = messages[i];
    if (!candidate || candidate.role !== "user") {
      continue;
    }
    if (hasMeaningfulConversationContent(candidate)) {
      return true;
    }
  }
  return false;
}
