import { AppError, ExternalServiceError } from "./errors";
import { nowJakartaIso } from "./time";

type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN =
  /token|secret|passcode|password|api_?key|authorization|cookie/i;

export function redactSecrets(input: string): string {
  return input
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /([?&](?:key|token|secret|passcode|api_key)=)[^&\s"']+/gi,
      "$1[REDACTED]"
    )
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza[REDACTED]");
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }
  if (depth >= 4) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, seen, depth + 1));
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeValue(entryValue, seen, depth + 1);
      }
    }
    return sanitized;
  }
  return String(value);
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  return sanitizeValue(meta, new WeakSet<object>()) as Record<string, unknown>;
}

function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      name: error.name,
      message: redactSecrets(error.message),
    };
    if (error instanceof AppError) {
      details.code = error.code;
      details.statusCode = error.statusCode;
    }
    if (error instanceof ExternalServiceError) {
      details.service = error.service;
    }
    if ("code" in error && typeof error.code === "string" && !details.code) {
      details.code = error.code;
    }
    if (depth < 2 && error.cause !== undefined) {
      details.cause = serializeError(error.cause, depth + 1);
    }
    return details;
  }

  if (typeof error === "string") {
    return { message: redactSecrets(error) };
  }

  return {
    message: "Non-Error thrown",
    detail: sanitizeValue(error, new WeakSet<object>()),
  };
}

function emitLog(
  level: LogLevel,
  event: string,
  payload: Record<string, unknown>
): void {
  const line = JSON.stringify({
    timestamp: nowJakartaIso(),
    level,
    event,
    ...payload,
  });

  if (level === "info") {
    console.info(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.error(line);
  }
}

export const logger = {
  info(event: string, meta?: Record<string, unknown>): void {
    const sanitized = sanitizeMeta(meta);
    emitLog("info", event, sanitized ? { meta: sanitized } : {});
  },

  warn(event: string, meta?: Record<string, unknown>): void {
    const sanitized = sanitizeMeta(meta);
    emitLog("warn", event, sanitized ? { meta: sanitized } : {});
  },

  error(
    event: string,
    error: unknown,
    meta?: Record<string, unknown>
  ): void {
    const sanitized = sanitizeMeta(meta);
    emitLog("error", event, {
      error: serializeError(error),
      ...(sanitized ? { meta: sanitized } : {}),
    });
  },
};
