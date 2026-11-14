import { Redis, errors } from "@upstash/redis";
import type {
  DeviceHeartbeat,
  RedisHealthMetrics,
  TransactionLogItem,
} from "@/types/logs";
import { ConfigError, ExternalServiceError } from "./errors";
import { logger } from "./logger";
import { nowJakartaIso } from "./time";

const LOG_IDS_KEY = "mm:logs:ids";
const LOG_ITEM_PREFIX = "mm:log:";
const IDEMPOTENCY_PREFIX = "mm:idem:";
const HEARTBEAT_KEY = "mm:device:heartbeat";
const API_LATENCY_KEY = "mm:metrics:api_latency";

const LOG_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_LOG_IDS = 500;
const MAX_LATENCY_SAMPLES = 100;
const HEARTBEAT_ONLINE_WINDOW_SECONDS = 3600;

interface StoredDeviceHeartbeat {
  lastSeenAt: string;
  lastEvent: "WEBHOOK" | "ACK" | "PING";
  appName?: string;
  deviceModel?: string;
  batteryLevel?: number;
}

let cachedClient: { cacheKey: string; client: Redis } | null = null;

export function isRedisConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return Boolean(url && token);
}

function getRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    throw new ConfigError(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured"
    );
  }

  const cacheKey = `${url}\0${token}`;
  if (cachedClient && cachedClient.cacheKey === cacheKey) {
    return cachedClient.client;
  }

  const client = Redis.fromEnv();
  cachedClient = { cacheKey, client };
  return client;
}

function isNarrowRedisError(error: unknown): boolean {
  if (
    error instanceof errors.UpstashError ||
    error instanceof errors.UrlError ||
    error instanceof TypeError ||
    error instanceof SyntaxError ||
    error instanceof DOMException
  ) {
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

function wrapRedisError(operation: string, error: unknown): never {
  if (error instanceof ConfigError) {
    throw error;
  }
  if (isNarrowRedisError(error)) {
    logger.error("redis.operation_failed", error, { operation });
    const message =
      error instanceof Error ? error.message : "Redis request failed";
    throw new ExternalServiceError("REDIS", message, error);
  }
  throw error;
}

function parseStoredValue<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      if (err instanceof SyntaxError) {
        logger.warn("redis.corrupt_json_value", { reason: err.message });
        return null;
      }
      throw err;
    }
  }
  if (typeof raw === "object") {
    return raw as T;
  }
  return null;
}

export async function saveTransactionLog(
  item: TransactionLogItem
): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis
      .pipeline()
      .set(`${LOG_ITEM_PREFIX}${item.id}`, item, { ex: LOG_TTL_SECONDS })
      .lpush(LOG_IDS_KEY, item.id)
      .ltrim(LOG_IDS_KEY, 0, MAX_LOG_IDS - 1)
      .exec();
  } catch (err) {
    wrapRedisError("saveTransactionLog", err);
  }
}

export async function getTransactionLogById(
  id: string
): Promise<TransactionLogItem | null> {
  if (!id) {
    return null;
  }
  const redis = getRedisClient();
  try {
    const raw = await redis.get<TransactionLogItem | string>(
      `${LOG_ITEM_PREFIX}${id}`
    );
    return parseStoredValue<TransactionLogItem>(raw);
  } catch (err) {
    wrapRedisError("getTransactionLogById", err);
  }
}

export async function updateTransactionLog(
  id: string,
  patch: Partial<TransactionLogItem>
): Promise<TransactionLogItem | null> {
  if (!id) {
    return null;
  }
  const existing = await getTransactionLogById(id);
  if (!existing) {
    return null;
  }

  const updated: TransactionLogItem = {
    ...existing,
    ...patch,
    id: existing.id,
  };

  const redis = getRedisClient();
  try {
    await redis.set(`${LOG_ITEM_PREFIX}${id}`, updated, {
      ex: LOG_TTL_SECONDS,
    });
    return updated;
  } catch (err) {
    wrapRedisError("updateTransactionLog", err);
  }
}

export async function getTransactionLogs(
  limit = 100
): Promise<TransactionLogItem[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), MAX_LOG_IDS));
  const redis = getRedisClient();
  try {
    const rawIds = await redis.lrange<string>(LOG_IDS_KEY, 0, safeLimit - 1);
    const uniqueIds = Array.from(
      new Set(rawIds.filter((id) => typeof id === "string" && id.length > 0))
    );
    if (uniqueIds.length === 0) {
      return [];
    }

    const keys = uniqueIds.map((id) => `${LOG_ITEM_PREFIX}${id}`);
    const rawItems = await redis.mget<(TransactionLogItem | string | null)[]>(
      ...keys
    );

    const results: TransactionLogItem[] = [];
    for (const rawItem of rawItems) {
      const parsed = parseStoredValue<TransactionLogItem>(rawItem);
      if (parsed && typeof parsed.id === "string") {
        results.push(parsed);
      }
    }
    return results;
  } catch (err) {
    wrapRedisError("getTransactionLogs", err);
  }
}

export async function claimIdempotencyKey(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  if (!key) {
    return false;
  }
  const safeTtl = Math.max(1, Math.floor(ttlSeconds));
  const redis = getRedisClient();
  try {
    const result = await redis.set(`${IDEMPOTENCY_PREFIX}${key}`, "1", {
      ex: safeTtl,
      nx: true,
    });
    return result === "OK";
  } catch (err) {
    wrapRedisError("claimIdempotencyKey", err);
  }
}

export async function recordDeviceHeartbeat(
  event: "WEBHOOK" | "ACK" | "PING",
  meta?: { appName?: string; deviceModel?: string; batteryLevel?: number }
): Promise<void> {
  const redis = getRedisClient();
  const payload: StoredDeviceHeartbeat = {
    lastSeenAt: nowJakartaIso(),
    lastEvent: event,
    ...(meta?.appName ? { appName: meta.appName } : {}),
    ...(meta?.deviceModel ? { deviceModel: meta.deviceModel } : {}),
    ...(typeof meta?.batteryLevel === "number" &&
    Number.isFinite(meta.batteryLevel)
      ? { batteryLevel: meta.batteryLevel }
      : {}),
  };

  try {
    await redis.set(HEARTBEAT_KEY, payload);
  } catch (err) {
    wrapRedisError("recordDeviceHeartbeat", err);
  }
}

export async function getDeviceHeartbeat(): Promise<DeviceHeartbeat> {
  const redis = getRedisClient();
  try {
    const raw = await redis.get<StoredDeviceHeartbeat | string>(HEARTBEAT_KEY);
    const stored = parseStoredValue<StoredDeviceHeartbeat>(raw);
    if (!stored || !stored.lastSeenAt) {
      return {
        lastSeenAt: null,
        isOnline: false,
        secondsSinceLastSeen: null,
      };
    }

    const lastSeenMs = Date.parse(stored.lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) {
      return {
        lastSeenAt: null,
        isOnline: false,
        secondsSinceLastSeen: null,
      };
    }

    const secondsSinceLastSeen = Math.max(
      0,
      Math.floor((Date.now() - lastSeenMs) / 1000)
    );

    return {
      lastSeenAt: stored.lastSeenAt,
      isOnline: secondsSinceLastSeen <= HEARTBEAT_ONLINE_WINDOW_SECONDS,
      secondsSinceLastSeen,
      lastEvent: stored.lastEvent,
      appName: stored.appName,
      deviceModel: stored.deviceModel,
      batteryLevel: stored.batteryLevel,
    };
  } catch (err) {
    wrapRedisError("getDeviceHeartbeat", err);
  }
}

export async function recordApiLatencySample(latencyMs: number): Promise<void> {
  const sample = Math.max(0, Math.round(latencyMs));
  if (!Number.isFinite(sample)) {
    return;
  }
  const redis = getRedisClient();
  try {
    await redis
      .pipeline()
      .lpush(API_LATENCY_KEY, sample)
      .ltrim(API_LATENCY_KEY, 0, MAX_LATENCY_SAMPLES - 1)
      .exec();
  } catch (err) {
    wrapRedisError("recordApiLatencySample", err);
  }
}

export async function getAverageApiLatencyMs(): Promise<number> {
  const redis = getRedisClient();
  try {
    const rawSamples = await redis.lrange<number | string>(
      API_LATENCY_KEY,
      0,
      MAX_LATENCY_SAMPLES - 1
    );
    let total = 0;
    let count = 0;
    for (const raw of rawSamples) {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(value) && value >= 0) {
        total += value;
        count += 1;
      }
    }
    return count === 0 ? 0 : Math.round(total / count);
  } catch (err) {
    wrapRedisError("getAverageApiLatencyMs", err);
  }
}

export async function checkRedisHealth(): Promise<RedisHealthMetrics> {
  if (!isRedisConfigured()) {
    return {
      status: "ERROR",
      latencyMs: 0,
      totalLogs: 0,
      errorMessage: "Upstash Redis environment variables are not configured",
    };
  }

  const startedAt = performance.now();
  try {
    const redis = getRedisClient();
    await redis.ping();
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const totalLogs = await redis.llen(LOG_IDS_KEY);
    return {
      status: "ONLINE",
      latencyMs,
      totalLogs,
    };
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (err instanceof ConfigError || isNarrowRedisError(err)) {
      logger.error("redis.health_check_failed", err, { latencyMs });
      return {
        status: "ERROR",
        latencyMs,
        totalLogs: 0,
        errorMessage:
          err instanceof Error ? err.message : "Redis health check failed",
      };
    }
    throw err;
  }
}
