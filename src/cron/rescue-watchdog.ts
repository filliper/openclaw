import net from "node:net";
import { isValidProfileName } from "../cli/profile-utils.js";
import { createConfigIO } from "../config/io.js";
import { resolveGatewayPort } from "../config/paths.js";
import { resolveGatewayService } from "../daemon/service.js";
import { resolveGatewayProbeAuthSafe } from "../gateway/probe-auth.js";
import { probeGateway } from "../gateway/probe.js";
import { pickPrimaryTailnetIPv4 } from "../infra/tailnet.js";
import { runCommandWithTimeout } from "../process/exec.js";
import {
  buildRescueProfileEnv,
  canEnableRescueWatchdog,
  resolveMonitoredProfileName,
} from "../rescue/watchdog-shared.js";
import type { CronJob, CronRunOutcome, CronRunTelemetry } from "./types.js";

const PROBE_TIMEOUT_MS = 1_500;
const PROBE_POLL_MS = 500;
const RECOVERY_WAIT_DEADLINE_MS = 30_000;
const DOCTOR_REPAIR_TIMEOUT_MS = 60_000;
const MIN_DOCTOR_TIMEOUT_MS = 1_000;
const RESTART_TIMEOUT_MS = 15_000;
const MIN_RESTART_TIMEOUT_MS = 500;

function looksLikeAuthClose(code: number | undefined, reason: string | undefined): boolean {
  if (code !== 1008) {
    return false;
  }
  const normalized = (reason ?? "").toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("scope") ||
    normalized.includes("role")
  );
}

function summarizeProbeFailure(result: Awaited<ReturnType<typeof probeGateway>>): string {
  if (result.error?.trim()) {
    return result.error.trim();
  }
  if (result.close) {
    const reason = result.close.reason?.trim();
    return reason ? `close ${result.close.code}: ${reason}` : `close ${result.close.code}`;
  }
  return "unreachable";
}

function summarizeCommandFailure(
  result: Awaited<ReturnType<typeof runCommandWithTimeout>>,
): string {
  const output = [result.stderr.trim(), result.stdout.trim()].find(Boolean);
  if (output) {
    return output;
  }
  if (result.termination === "timeout" || result.termination === "no-output-timeout") {
    return "command timed out";
  }
  if (result.signal) {
    return `terminated by ${result.signal}`;
  }
  return `exit code ${result.code ?? "unknown"}`;
}

function formatGatewayProbeHost(host: string): string {
  return net.isIP(host) === 6 && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveProfileGatewayProbeUrl(
  cfg: {
    gateway?: {
      bind?: string;
      customBindHost?: string;
      tls?: { enabled?: boolean };
    };
  },
  port: number,
): string {
  const scheme = cfg.gateway?.tls?.enabled === true ? "wss" : "ws";
  const bindMode = cfg.gateway?.bind ?? "loopback";
  const customBindHost = cfg.gateway?.customBindHost?.trim();
  const host =
    bindMode === "custom" && customBindHost
      ? customBindHost
      : bindMode === "tailnet"
        ? (pickPrimaryTailnetIPv4() ?? "127.0.0.1")
        : "127.0.0.1";
  return `${scheme}://${formatGatewayProbeHost(host)}:${port}`;
}

async function probeProfileGateway(params: {
  cfg: {
    gateway?: {
      bind?: string;
      customBindHost?: string;
      tls?: { enabled?: boolean };
    };
  };
  port: number;
  auth: { token?: string; password?: string };
}): Promise<{ healthy: boolean; detail?: string }> {
  const probe = await probeGateway({
    url: resolveProfileGatewayProbeUrl(params.cfg, params.port),
    auth:
      params.auth.token || params.auth.password
        ? { token: params.auth.token, password: params.auth.password }
        : undefined,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (probe.ok || looksLikeAuthClose(probe.close?.code, probe.close?.reason)) {
    return { healthy: true };
  }
  return { healthy: false, detail: summarizeProbeFailure(probe) };
}

async function waitForProfileGateway(params: {
  cfg: {
    gateway?: {
      bind?: string;
      customBindHost?: string;
      tls?: { enabled?: boolean };
    };
  };
  port: number;
  auth: { token?: string; password?: string };
  abortSignal?: AbortSignal;
}): Promise<{ healthy: boolean; detail?: string }> {
  const deadlineAt = Date.now() + RECOVERY_WAIT_DEADLINE_MS;
  let lastDetail: string | undefined;
  while (Date.now() < deadlineAt) {
    if (params.abortSignal?.aborted) {
      return { healthy: false, detail: "aborted" };
    }
    const probe = await probeProfileGateway(params);
    if (probe.healthy) {
      return probe;
    }
    lastDetail = probe.detail;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        params.abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      }, PROBE_POLL_MS);
      const onAbort = () => {
        clearTimeout(timer);
        params.abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      };
      params.abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  return { healthy: false, detail: lastDetail ?? "unreachable after restart" };
}

function buildSummary(monitoredProfile: string, actions: string[]): string {
  if (actions.length === 0) {
    return `Rescue watchdog checked "${monitoredProfile}" and found it healthy.`;
  }
  return `Rescue watchdog repaired "${monitoredProfile}": ${actions.join(", ")}.`;
}

function resolveRemainingJobBudgetMs(params: {
  startedAtMs: number;
  payload: CronJob["payload"];
}): number | undefined {
  if (
    params.payload.kind !== "rescueWatchdog" ||
    typeof params.payload.timeoutSeconds !== "number" ||
    params.payload.timeoutSeconds <= 0
  ) {
    return undefined;
  }
  return Math.max(
    0,
    Math.floor(params.payload.timeoutSeconds * 1_000) - (Date.now() - params.startedAtMs),
  );
}

type RunBoundedResult = { ok: true } | { ok: false; error: string; aborted: boolean };

async function runBoundedStep(params: {
  run: () => Promise<void>;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  label: string;
}): Promise<RunBoundedResult> {
  if (params.abortSignal?.aborted) {
    return { ok: false, error: `${params.label} aborted`, aborted: true };
  }
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const runPromise = params.run().then(
      () => ({ kind: "done" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), params.timeoutMs);
    });
    const abortPromise = new Promise<{ kind: "aborted" }>((resolve) => {
      if (!params.abortSignal) {
        return;
      }
      onAbort = () => resolve({ kind: "aborted" });
      params.abortSignal.addEventListener("abort", onAbort, { once: true });
    });

    const outcome = await Promise.race([runPromise, timeoutPromise, abortPromise]);
    if (outcome.kind === "done") {
      return { ok: true };
    }
    if (outcome.kind === "error") {
      return {
        ok: false,
        error: outcome.error instanceof Error ? outcome.error.message : `${params.label} failed`,
        aborted: false,
      };
    }
    if (outcome.kind === "aborted") {
      return { ok: false, error: `${params.label} aborted`, aborted: true };
    }
    return {
      ok: false,
      error: `${params.label} timed out after ${params.timeoutMs}ms`,
      aborted: false,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (params.abortSignal && onAbort) {
      params.abortSignal.removeEventListener("abort", onAbort);
    }
  }
}

export async function runRescueWatchdogJob(params: {
  job: CronJob;
  monitoredProfile: string;
  abortSignal?: AbortSignal;
}): Promise<CronRunOutcome & CronRunTelemetry> {
  const startedAtMs = Date.now();
  const monitoredProfile = resolveMonitoredProfileName(params.monitoredProfile);
  if (monitoredProfile !== "default" && !isValidProfileName(monitoredProfile)) {
    return {
      status: "error",
      error: `invalid monitored profile "${monitoredProfile}"`,
    };
  }
  if (!canEnableRescueWatchdog(monitoredProfile)) {
    return {
      status: "error",
      error: `invalid monitored profile "${monitoredProfile}": rescue watchdog cannot monitor rescue profiles`,
    };
  }

  const env = buildRescueProfileEnv(monitoredProfile);
  let cfg;
  try {
    cfg = createConfigIO({ env }).loadConfig();
  } catch (error) {
    return {
      status: "error",
      error: `failed to load monitored profile config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const port = resolveGatewayPort(cfg, env);
  const { auth, warning } = resolveGatewayProbeAuthSafe({
    cfg,
    mode: "local",
    env,
  });
  let service;
  try {
    service = resolveGatewayService();
  } catch (error) {
    return {
      status: "error",
      error: `gateway service control unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const actions: string[] = [];

  const initialProbe = await probeProfileGateway({ cfg, port, auth });
  if (initialProbe.healthy) {
    return {
      status: "ok",
      summary: buildSummary(monitoredProfile, actions),
    };
  }

  let restartError: string | undefined;
  const remainingBeforeRestartMs = resolveRemainingJobBudgetMs({
    startedAtMs,
    payload: params.job.payload,
  });
  if (
    typeof remainingBeforeRestartMs === "number" &&
    remainingBeforeRestartMs < MIN_RESTART_TIMEOUT_MS
  ) {
    restartError = `skipped restart because only ${remainingBeforeRestartMs}ms remained in the cron job budget`;
  } else {
    const restartTimeoutMs =
      typeof remainingBeforeRestartMs === "number"
        ? Math.min(RESTART_TIMEOUT_MS, remainingBeforeRestartMs)
        : RESTART_TIMEOUT_MS;
    const restartResult = await runBoundedStep({
      run: () => service.restart({ env, stdout: process.stdout }),
      timeoutMs: restartTimeoutMs,
      abortSignal: params.abortSignal,
      label: "service restart",
    });
    if (restartResult.ok) {
      actions.push("restarted managed gateway service");
    } else {
      restartError = restartResult.error;
      if (restartResult.aborted) {
        return {
          status: "error",
          error: restartResult.error,
          summary: actions.length > 0 ? buildSummary(monitoredProfile, actions) : undefined,
        };
      }
    }
  }

  const restartProbe = await waitForProfileGateway({
    cfg,
    port,
    auth,
    abortSignal: params.abortSignal,
  });
  if (restartProbe.healthy) {
    return {
      status: "ok",
      summary: buildSummary(monitoredProfile, actions),
    };
  }

  const remainingJobBudgetMs = resolveRemainingJobBudgetMs({
    startedAtMs,
    payload: params.job.payload,
  });
  if (typeof remainingJobBudgetMs === "number" && remainingJobBudgetMs < MIN_DOCTOR_TIMEOUT_MS) {
    const errors = [
      warning,
      restartError ? `restart failed: ${restartError}` : undefined,
      `skipped doctor fallback because only ${remainingJobBudgetMs}ms remained in the cron job budget`,
      `probe failed: ${restartProbe.detail ?? initialProbe.detail ?? "unreachable"}`,
    ].filter(Boolean);
    return {
      status: "error",
      error: errors.join(" | "),
      summary: actions.length > 0 ? buildSummary(monitoredProfile, actions) : undefined,
    };
  }

  // Keep the repair fallback deterministic: exact argv, no shell, no agent prompt.
  const doctorResult = await runCommandWithTimeout(
    ["openclaw", "--profile", monitoredProfile, "doctor", "--repair", "--non-interactive"],
    {
      timeoutMs:
        typeof remainingJobBudgetMs === "number"
          ? Math.min(DOCTOR_REPAIR_TIMEOUT_MS, remainingJobBudgetMs)
          : DOCTOR_REPAIR_TIMEOUT_MS,
      env,
    },
  );
  if (doctorResult.code === 0) {
    actions.push("ran doctor --repair --non-interactive");
  }

  const doctorProbe = await waitForProfileGateway({
    cfg,
    port,
    auth,
    abortSignal: params.abortSignal,
  });
  if (doctorProbe.healthy) {
    return {
      status: "ok",
      summary: buildSummary(monitoredProfile, actions),
    };
  }

  const errors = [
    warning,
    restartError ? `restart failed: ${restartError}` : undefined,
    doctorResult.code === 0 ? undefined : `doctor failed: ${summarizeCommandFailure(doctorResult)}`,
    `probe failed: ${doctorProbe.detail ?? restartProbe.detail ?? initialProbe.detail ?? "unreachable"}`,
  ].filter(Boolean);

  return {
    status: "error",
    error: errors.join(" | "),
    summary: actions.length > 0 ? buildSummary(monitoredProfile, actions) : undefined,
  };
}
