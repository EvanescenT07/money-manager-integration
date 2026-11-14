import type { MacrodroidInputPayload, PingResponse } from "@/types/api";
import { logger } from "./logger";
import { nowJakartaIso } from "./time";

const MACRODROID_TIMEOUT_MS = 8_000;

function isNarrowFetchError(error: unknown): boolean {
  if (error instanceof TypeError || error instanceof DOMException) {
    return true;
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  return false;
}

function getMacrodroidConfig():
  | { ok: true; webhookUrl: string; secret: string }
  | { ok: false; errorMessage: string } {
  const webhookUrl = process.env.MACRODROID_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { ok: false, errorMessage: "MACRODROID_WEBHOOK_URL is not configured" };
  }

  try {
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        ok: false,
        errorMessage: "MACRODROID_WEBHOOK_URL must use http or https",
      };
    }
  } catch (err) {
    if (err instanceof TypeError) {
      return {
        ok: false,
        errorMessage: "MACRODROID_WEBHOOK_URL is not a valid URL",
      };
    }
    throw err;
  }

  const secret = process.env.MACRODROID_SECRET?.trim();
  if (!secret) {
    return { ok: false, errorMessage: "MACRODROID_SECRET is not configured" };
  }

  return { ok: true, webhookUrl, secret };
}

async function postMacrodroidJson(
  body: Record<string, unknown> | MacrodroidInputPayload
): Promise<{
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  errorMessage?: string;
}> {
  const config = getMacrodroidConfig();
  if (!config.ok) {
    logger.warn("macrodroid.config_missing", { reason: config.errorMessage });
    return {
      ok: false,
      statusCode: 0,
      latencyMs: 0,
      errorMessage: config.errorMessage,
    };
  }

  const startedAt = performance.now();
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Macrodroid-Secret": config.secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MACRODROID_TIMEOUT_MS),
    });

    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (!response.ok) {
      const responseSnippet = (await response.text()).slice(0, 200).trim();
      const errorMessage = responseSnippet
        ? `MacroDroid HTTP ${response.status}: ${responseSnippet}`
        : `MacroDroid responded with HTTP ${response.status}`;
      logger.warn("macrodroid.http_error", {
        statusCode: response.status,
        latencyMs,
      });
      return {
        ok: false,
        statusCode: response.status,
        latencyMs,
        errorMessage,
      };
    }

    return {
      ok: true,
      statusCode: response.status,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (isNarrowFetchError(err)) {
      logger.error("macrodroid.request_failed", err, { latencyMs });
      return {
        ok: false,
        statusCode: 0,
        latencyMs,
        errorMessage:
          err instanceof Error
            ? err.message
            : "MacroDroid webhook request failed",
      };
    }
    throw err;
  }
}

export async function dispatchToMacrodroid(
  payload: MacrodroidInputPayload
): Promise<{
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  errorMessage?: string;
}> {
  return postMacrodroidJson(payload);
}

export async function pingMacrodroid(): Promise<PingResponse> {
  const timestamp = nowJakartaIso();
  const result = await postMacrodroidJson({
    action: "PING",
    source: "DASHBOARD",
    timestamp,
  });

  return {
    ok: result.ok,
    reachable: result.ok,
    latencyMs: result.latencyMs,
    timestamp,
    message: result.ok
      ? "MacroDroid webhook reachable"
      : "MacroDroid webhook unreachable",
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
  };
}
