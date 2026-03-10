import { describe, expect, it } from "vitest";
import { buildRescueProfileEnv, canEnableRescueWatchdog } from "./watchdog-shared.js";

describe("buildRescueProfileEnv", () => {
  it("recomputes state/config paths for the requested profile", () => {
    const env = buildRescueProfileEnv("work", {
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/tester",
      OPENCLAW_STATE_DIR: "/srv/openclaw-home/.openclaw-rescue",
      OPENCLAW_CONFIG_PATH: "/srv/openclaw-home/.openclaw-rescue/openclaw.json",
    });

    expect(env.OPENCLAW_PROFILE).toBe("work");
    expect(env.OPENCLAW_STATE_DIR).toBe("/srv/openclaw-home/.openclaw-work");
    expect(env.OPENCLAW_CONFIG_PATH).toBe("/srv/openclaw-home/.openclaw-work/openclaw.json");
  });
});

describe("canEnableRescueWatchdog", () => {
  it("rejects rescue profile shapes", () => {
    expect(canEnableRescueWatchdog("rescue")).toBe(false);
    expect(canEnableRescueWatchdog("work-rescue")).toBe(false);
  });
});
