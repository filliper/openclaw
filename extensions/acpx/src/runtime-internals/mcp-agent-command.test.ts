import { describe, expect, it } from "vitest";
import { resolveAcpxAgentCommand } from "./mcp-agent-command.js";

describe("resolveAcpxAgentCommand", () => {
  it("uses Gemini CLI ACP mode for the built-in gemini agent", async () => {
    const command = await resolveAcpxAgentCommand({
      acpxCommand: "definitely-not-a-real-acpx-binary",
      cwd: "/tmp",
      agent: "gemini",
    });

    expect(command).toBe("gemini --experimental-acp");
  });
});
