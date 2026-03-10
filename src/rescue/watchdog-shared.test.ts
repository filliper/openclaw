import { describe, expect, it } from "vitest";
import { buildRescueProfileEnv, canEnableRescueWatchdog } from "./watchdog-shared.js";

function toPosixPath(value: string | undefined): string {
  return (value ?? "").replaceAll("\\", "/");
}

describe("buildRescueProfileEnv", () => {
  it("recomputes state/config paths for the requested profile", () => {
    const env = buildRescueProfileEnv("work", {
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/tester",
      OPENCLAW_STATE_DIR: "/srv/openclaw-home/.openclaw-rescue",
      OPENCLAW_CONFIG_PATH: "/srv/openclaw-home/.openclaw-rescue/openclaw.json",
    });

    expect(env.OPENCLAW_PROFILE).toBe("work");
    expect(toPosixPath(env.OPENCLAW_STATE_DIR)).toMatch(/\/srv\/openclaw-home\/\.openclaw-work$/);
    expect(toPosixPath(env.OPENCLAW_CONFIG_PATH)).toMatch(
      /\/srv\/openclaw-home\/\.openclaw-work\/openclaw\.json$/,
    );
  });

  it("preserves daemon service identity overrides", () => {
    const env = buildRescueProfileEnv("work", {
      HOME: "/home/tester",
      OPENCLAW_PROFILE: "work",
      OPENCLAW_LAUNCHD_LABEL: "com.example.openclaw-work",
      OPENCLAW_SYSTEMD_UNIT: "openclaw-work-custom.service",
      OPENCLAW_WINDOWS_TASK_NAME: "OpenClaw Gateway (work custom)",
    });

    expect(env.OPENCLAW_LAUNCHD_LABEL).toBe("com.example.openclaw-work");
    expect(env.OPENCLAW_SYSTEMD_UNIT).toBe("openclaw-work-custom.service");
    expect(env.OPENCLAW_WINDOWS_TASK_NAME).toBe("OpenClaw Gateway (work custom)");
  });

  it("drops service identity overrides when deriving a different target profile", () => {
    const env = buildRescueProfileEnv("work", {
      HOME: "/home/tester",
      OPENCLAW_PROFILE: "rescue",
      OPENCLAW_LAUNCHD_LABEL: "com.example.openclaw-rescue",
      OPENCLAW_SYSTEMD_UNIT: "openclaw-rescue-custom.service",
      OPENCLAW_WINDOWS_TASK_NAME: "OpenClaw Gateway (rescue custom)",
    });

    expect(env.OPENCLAW_LAUNCHD_LABEL).toBeUndefined();
    expect(env.OPENCLAW_SYSTEMD_UNIT).toBeUndefined();
    expect(env.OPENCLAW_WINDOWS_TASK_NAME).toBeUndefined();
  });
});

describe("canEnableRescueWatchdog", () => {
  it("rejects rescue profile shapes", () => {
    expect(canEnableRescueWatchdog("rescue")).toBe(false);
    expect(canEnableRescueWatchdog("work-rescue")).toBe(false);
  });
});
