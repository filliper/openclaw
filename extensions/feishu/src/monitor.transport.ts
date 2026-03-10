import * as http from "http";
import { Readable } from "stream";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  applyBasicWebhookRequestGuards,
  type RuntimeEnv,
  installRequestBodyLimitGuard,
} from "openclaw/plugin-sdk/feishu";
import { createFeishuWSClient } from "./client.js";
import {
  botNames,
  botOpenIds,
  FEISHU_WEBHOOK_BODY_TIMEOUT_MS,
  FEISHU_WEBHOOK_MAX_BODY_BYTES,
  feishuWebhookRateLimiter,
  httpServers,
  recordWebhookStatus,
  webhookServerPool,
  wsClients,
  type WebhookServerEntry,
} from "./monitor.state.js";
import type { ResolvedFeishuAccount } from "./types.js";

export type MonitorTransportParams = {
  account: ResolvedFeishuAccount;
  accountId: string;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  eventDispatcher: Lark.EventDispatcher;
};

export async function monitorWebSocket({
  account,
  accountId,
  runtime,
  abortSignal,
  eventDispatcher,
}: MonitorTransportParams): Promise<void> {
  const log = runtime?.log ?? console.log;
  log(`feishu[${accountId}]: starting WebSocket connection...`);

  const wsClient = createFeishuWSClient(account);
  wsClients.set(accountId, wsClient);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      wsClients.delete(accountId);
      botOpenIds.delete(accountId);
      botNames.delete(accountId);
    };

    const handleAbort = () => {
      log(`feishu[${accountId}]: abort signal received, stopping`);
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    try {
      wsClient.start({ eventDispatcher });
      log(`feishu[${accountId}]: WebSocket client started`);
    } catch (err) {
      cleanup();
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    }
  });
}

export async function monitorWebhook({
  account,
  accountId,
  runtime,
  abortSignal,
  eventDispatcher,
}: MonitorTransportParams): Promise<void> {
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const port = account.config.webhookPort ?? 3000;
  const path = account.config.webhookPath ?? "/feishu/events";
  const host = account.config.webhookHost ?? "127.0.0.1";
  const serverKey = `${host}:${port}`;

  const webhookHandler = Lark.adaptDefault(path, eventDispatcher, { autoChallenge: true });

  // Re-use existing server when another account already listens on the same host:port.
  const existing = webhookServerPool.get(serverKey);
  if (existing) {
    existing.routes.set(accountId, {
      accountId,
      appId: account.appId?.trim() ?? "",
      token: account.verificationToken?.trim() ?? "",
      handler: createGuardedHandler({ accountId, path, runtime, error, handler: webhookHandler }),
    });
    httpServers.set(accountId, existing.server);
    log(
      `feishu[${accountId}]: joined shared Webhook server on ${serverKey} ` +
        `(${existing.routes.size} accounts)`,
    );

    return new Promise<void>((resolve) => {
      const handleAbort = () => {
        log(`feishu[${accountId}]: abort, leaving shared server on ${serverKey}`);
        existing.routes.delete(accountId);
        httpServers.delete(accountId);
        botOpenIds.delete(accountId);
        botNames.delete(accountId);
        if (existing.routes.size === 0) {
          existing.server.close();
          webhookServerPool.delete(serverKey);
        }
        resolve();
      };
      if (abortSignal?.aborted) {
        handleAbort();
        return;
      }
      abortSignal?.addEventListener("abort", handleAbort, { once: true });
    });
  }

  // First account on this host:port — create a new pooled server.
  log(`feishu[${accountId}]: starting Webhook server on ${host}:${port}, path ${path}...`);
  const server = http.createServer();
  const entry: WebhookServerEntry = {
    server,
    routes: new Map([
      [
        accountId,
        {
          accountId,
          appId: account.appId?.trim() ?? "",
          token: account.verificationToken?.trim() ?? "",
          handler: createGuardedHandler({
            accountId,
            path,
            runtime,
            error,
            handler: webhookHandler,
          }),
        },
      ],
    ]),
  };
  webhookServerPool.set(serverKey, entry);
  httpServers.set(accountId, server);

  server.on("request", createPoolDispatcher(entry));

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.close();
      webhookServerPool.delete(serverKey);
      for (const aid of entry.routes.keys()) {
        httpServers.delete(aid);
        botOpenIds.delete(aid);
        botNames.delete(aid);
      }
    };

    const handleAbort = () => {
      log(`feishu[${accountId}]: abort signal received, stopping Webhook server`);
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    server.listen(port, host, () => {
      log(`feishu[${accountId}]: Webhook server listening on ${host}:${port}`);
    });

    server.on("error", (err) => {
      error(`feishu[${accountId}]: Webhook server error: ${err}`);
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Internal helpers — kept private to this module.
// ---------------------------------------------------------------------------

/** Wrap an account's Lark handler with the existing rate-limit / body-guard
 *  logic.  Signature stays `(req, res) => void` so it slots into the route. */
function createGuardedHandler(opts: {
  accountId: string;
  path: string;
  runtime?: RuntimeEnv;
  error: (...args: unknown[]) => void;
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    res.on("finish", () => {
      recordWebhookStatus(opts.runtime, opts.accountId, opts.path, res.statusCode);
    });

    const rateLimitKey = `${opts.accountId}:${opts.path}:${req.socket.remoteAddress ?? "unknown"}`;
    if (
      !applyBasicWebhookRequestGuards({
        req,
        res,
        rateLimiter: feishuWebhookRateLimiter,
        rateLimitKey,
        nowMs: Date.now(),
        requireJsonContentType: true,
      })
    ) {
      return;
    }

    const guard = installRequestBodyLimitGuard(req, res, {
      maxBytes: FEISHU_WEBHOOK_MAX_BODY_BYTES,
      timeoutMs: FEISHU_WEBHOOK_BODY_TIMEOUT_MS,
      responseFormat: "text",
    });
    if (guard.isTripped()) {
      return;
    }

    void Promise.resolve(opts.handler(req, res))
      .catch((err) => {
        if (!guard.isTripped()) {
          opts.error(`feishu[${opts.accountId}]: webhook handler error: ${String(err)}`);
        }
      })
      .finally(() => {
        guard.dispose();
      });
  };
}

/** Create the single `request` listener for a pooled server.
 *
 *  - 1 route  → fast-path: delegate directly (zero body parsing overhead).
 *  - N routes → read body once, extract `header.token` / `header.app_id` for
 *               routing, then replay the body as a new Readable stream. */
function createPoolDispatcher(entry: WebhookServerEntry) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Fast path: single account — no routing needed.
    if (entry.routes.size === 1) {
      const route = entry.routes.values().next().value;
      if (route) route.handler(req, res);
      return;
    }

    // Multi-account: buffer body to extract the routing token.
    // Enforce the same body size limit used by the per-account guard so an
    // oversized payload is rejected before we finish buffering.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      totalBytes += c.length;
      if (totalBytes > FEISHU_WEBHOOK_MAX_BODY_BYTES) {
        aborted = true;
        res.statusCode = 413;
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks);
      const route = resolveRoute(entry, raw);
      if (!route) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }
      route.handler(replayRequest(req, raw), res);
    });
    req.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 400;
        res.end("Bad Request");
      }
    });
  };
}

/** Pick the matching route by verification token, then app_id. */
function resolveRoute(entry: WebhookServerEntry, body: Buffer) {
  let token: string | undefined;
  let appId: string | undefined;
  let type: string | undefined;
  try {
    const json = JSON.parse(body.toString("utf-8"));
    token = json.header?.token ?? json.token;
    appId = json.header?.app_id ?? json.event?.app_id;
    type = json.type;
  } catch {
    return undefined;
  }

  for (const route of entry.routes.values()) {
    if (token && route.token && route.token === token) return route;
  }
  for (const route of entry.routes.values()) {
    if (appId && route.appId && route.appId === appId) return route;
  }
  // url_verification: any account can respond.
  if (type === "url_verification") return entry.routes.values().next().value;
  return undefined;
}

/** Create a Readable that replays `rawBody` while preserving original request
 *  properties so downstream handlers (Lark SDK) can consume it normally. */
function replayRequest(original: http.IncomingMessage, rawBody: Buffer): http.IncomingMessage {
  const stream = new Readable({ read() {} });
  stream.push(rawBody);
  stream.push(null);
  Object.assign(stream, {
    method: original.method,
    url: original.url,
    headers: original.headers,
    rawHeaders: original.rawHeaders,
    httpVersion: original.httpVersion,
    socket: original.socket,
    connection: original.connection,
  });
  return stream as unknown as http.IncomingMessage;
}
