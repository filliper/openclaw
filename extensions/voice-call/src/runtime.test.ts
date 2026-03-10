import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceCallConfig } from "./config.js";
import { createVoiceCallRuntime } from "./runtime.js";

const {
  startTunnelMock,
  setupTailscaleExposureMock,
  cleanupTailscaleExposureMock,
  webhookServerStartMock,
  webhookServerStopMock,
  getMediaStreamHandlerMock,
} = vi.hoisted(() => ({
  startTunnelMock: vi.fn(),
  setupTailscaleExposureMock: vi.fn(),
  cleanupTailscaleExposureMock: vi.fn(),
  webhookServerStartMock: vi.fn(),
  webhookServerStopMock: vi.fn(),
  getMediaStreamHandlerMock: vi.fn(),
}));

vi.mock("./tunnel.js", () => ({
  startTunnel: startTunnelMock,
}));

vi.mock("./webhook.js", () => ({
  cleanupTailscaleExposure: cleanupTailscaleExposureMock,
  setupTailscaleExposure: setupTailscaleExposureMock,
  VoiceCallWebhookServer: class {
    start = webhookServerStartMock;
    stop = webhookServerStopMock;
    getMediaStreamHandler = getMediaStreamHandlerMock;
  },
}));

function createBaseConfig(): VoiceCallConfig {
  return {
    enabled: true,
    provider: "twilio",
    fromNumber: "+15550001234",
    toNumber: "+15550009999",
    inboundPolicy: "disabled",
    allowFrom: [],
    outbound: { defaultMode: "notify", notifyHangupDelaySec: 3 },
    maxDurationSeconds: 300,
    staleCallReaperSeconds: 600,
    silenceTimeoutMs: 800,
    transcriptTimeoutMs: 180000,
    ringTimeoutMs: 30000,
    maxConcurrentCalls: 1,
    serve: { port: 3334, bind: "127.0.0.1", path: "/voice/webhook" },
    tailscale: { mode: "off", path: "/voice/webhook" },
    tunnel: { provider: "none", allowNgrokFreeTierLoopbackBypass: false },
    webhookSecurity: {
      allowedHosts: [],
      trustForwardingHeaders: false,
      trustedProxyIPs: [],
    },
    streaming: {
      enabled: false,
      sttProvider: "openai-realtime",
      sttModel: "gpt-4o-transcribe",
      silenceDurationMs: 800,
      vadThreshold: 0.5,
      streamPath: "/voice/stream",
    },
    skipSignatureVerification: false,
    stt: { provider: "openai", model: "whisper-1" },
    tts: {
      provider: "openai",
      openai: { model: "gpt-4o-mini-tts", voice: "coral" },
    },
    responseModel: "openai/gpt-4o-mini",
    responseTimeoutMs: 30000,
    twilio: {
      accountSid: "AC123",
      authToken: "secret",
    },
  };
}

describe("createVoiceCallRuntime", () => {
  beforeEach(() => {
    startTunnelMock.mockReset();
    setupTailscaleExposureMock.mockReset();
    cleanupTailscaleExposureMock.mockReset();
    webhookServerStartMock.mockReset();
    webhookServerStopMock.mockReset();
    getMediaStreamHandlerMock.mockReset();

    startTunnelMock.mockResolvedValue(null);
    setupTailscaleExposureMock.mockResolvedValue(null);
    cleanupTailscaleExposureMock.mockResolvedValue(undefined);
    webhookServerStartMock.mockResolvedValue("http://127.0.0.1:3334/voice/webhook");
    webhookServerStopMock.mockResolvedValue(undefined);
    getMediaStreamHandlerMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when Twilio would fall back to a loopback-only webhook", async () => {
    const config = createBaseConfig();

    await expect(createVoiceCallRuntime({ config, coreConfig: {} })).rejects.toThrow(
      /twilio requires a publicly reachable webhook URL/i,
    );
  });

  it("uses a configured public URL for Twilio when available", async () => {
    const config = createBaseConfig();
    config.publicUrl = "https://voice.example.com/voice/webhook";

    const runtime = await createVoiceCallRuntime({ config, coreConfig: {} });

    expect(runtime.webhookUrl).toBe("https://voice.example.com/voice/webhook");
    expect(runtime.publicUrl).toBe("https://voice.example.com/voice/webhook");

    await runtime.stop();
  });
});
