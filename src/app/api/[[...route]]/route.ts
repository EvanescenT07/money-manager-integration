import { createHash, randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { handle } from "hono/vercel";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifyDashboardPasscode,
  verifyMacrodroidSecret,
  verifySessionToken,
  verifyTelegramSecret,
} from "@/lib/auth";
import {
  AppError,
  AuthError,
  ConfigError,
  ExternalServiceError,
} from "@/lib/errors";
import {
  checkGeminiHealth,
  extractTransactionsFromImage,
  extractTransactionsFromText,
  type GeminiExtractionResult,
} from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { dispatchToMacrodroid, pingMacrodroid } from "@/lib/macrodroid";
import {
  checkRedisHealth,
  claimIdempotencyKey,
  getAverageApiLatencyMs,
  getDeviceHeartbeat,
  getTransactionLogById,
  getTransactionLogs,
  isRedisConfigured,
  recordApiLatencySample,
  recordDeviceHeartbeat,
  saveTransactionLog,
  updateTransactionLog,
} from "@/lib/redis";
import {
  answerCallbackQuery,
  downloadTelegramFile,
  formatTransactionReport,
  getTelegramWebhookHealth,
  isAllowedTelegramChat,
  sendTelegramMessage,
} from "@/lib/telegram";
import { nowJakartaIso } from "@/lib/time";
import { buildRealbyteWorkbookBuffer } from "@/lib/xlsx";
import {
  ExportQuerySchema,
  LoginSchema,
  LogsQuerySchema,
  MacrodroidAckSchema,
  MacrodroidWebhookSchema,
  RetryParamsSchema,
  type ApiErrorResponse,
  type AuthSessionResponse,
  type HealthResponse,
  type LogsResponse,
  type MacrodroidInputPayload,
  type PingResponse,
  type RetryResponse,
} from "@/types/api";
import type {
  DeviceHeartbeat,
  GeminiHealthMetrics,
  ParsedTransactionData,
  RedisHealthMetrics,
  SystemOverallStatus,
  TelegramHealthMetrics,
  TransactionLogItem,
  TransactionLogSource,
  TransactionLogStatus,
} from "@/types/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MACRODROID_DEDUPE_TTL_SECONDS = 60;
const TELEGRAM_UPDATE_DEDUPE_TTL_SECONDS = 3600;
const EXPORT_MAX_FETCH_LIMIT = 500;

const TelegramPhotoSizeSchema = z.object({
  file_id: z.string().min(1),
  width: z.number().optional(),
  height: z.number().optional(),
  file_size: z.number().optional(),
});

const TelegramDocumentSchema = z.object({
  file_id: z.string().min(1),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

const TelegramChatSchema = z.object({
  id: z.union([z.number(), z.string()]),
  type: z.string().optional(),
});

const TelegramUserSchema = z.object({
  id: z.union([z.number(), z.string()]),
  username: z.string().optional(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number(),
  chat: TelegramChatSchema,
  from: TelegramUserSchema.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(TelegramPhotoSizeSchema).optional(),
  document: TelegramDocumentSchema.optional(),
});

const TelegramCallbackQuerySchema = z.object({
  id: z.string().min(1),
  from: TelegramUserSchema,
  data: z.string().optional(),
  message: TelegramMessageSchema.optional(),
});

const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackQuerySchema.optional(),
});

function toContentfulStatusCode(code: number): ContentfulStatusCode {
  if (code >= 400 && code <= 599) {
    return code as ContentfulStatusCode;
  }
  return 500;
}

function validationErrorResponse(
  c: Context,
  issues: ReadonlyArray<{ message?: string }>
) {
  const message = issues[0]?.message ?? "Invalid request payload";
  return c.json<ApiErrorResponse>(
    { ok: false, error: message, code: "VALIDATION_ERROR" },
    400
  );
}

function shouldUseSecureCookie(c: Context): boolean {
  const forwardedProto = c.req.header("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() === "https";
  }
  if (c.req.url.startsWith("https://")) {
    return true;
  }
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  try {
    const hostname = new URL(c.req.url).hostname;
    // Allow plain HTTP loopback testing (e.g. local `next start` smoke checks)
    return (
      hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1"
    );
  } catch (err) {
    if (err instanceof TypeError) {
      return true;
    }
    throw err;
  }
}

function extractMacrodroidSecret(c: Context): string | undefined {
  const headerSecret = c.req.header("x-macrodroid-secret");
  if (headerSecret) {
    return headerSecret;
  }
  const authorization = c.req.header("authorization");
  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return undefined;
}

const requireMacrodroidAuth: MiddlewareHandler = async (c, next) => {
  const providedSecret = extractMacrodroidSecret(c);
  if (!verifyMacrodroidSecret(providedSecret)) {
    logger.warn("macrodroid_webhook_unauthorized", { path: c.req.path });
    throw new AuthError("Invalid MacroDroid secret");
  }
  await next();
};

const requireTelegramAuth: MiddlewareHandler = async (c, next) => {
  const secretHeader = c.req.header("x-telegram-bot-api-secret-token");
  if (!verifyTelegramSecret(secretHeader)) {
    logger.warn("telegram_webhook_unauthorized", { path: c.req.path });
    throw new AuthError("Invalid Telegram webhook secret");
  }
  await next();
};

const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = verifySessionToken(token);
  if (!session.valid) {
    throw new AuthError("Unauthorized");
  }
  await next();
};

function buildMacrodroidPayload(
  log: TransactionLogItem,
  parsedData: ParsedTransactionData
): MacrodroidInputPayload {
  return {
    log_id: log.id,
    correlation_group_id: log.correlationGroupId,
    tx_index: log.txIndex,
    type: parsedData.type,
    account: parsedData.account,
    category: parsedData.category,
    subcategory: parsedData.subcategory,
    amount: parsedData.amount,
    currency: parsedData.currency,
    note: parsedData.note,
    description: parsedData.description,
    source: log.source,
    timestamp: log.timestamp,
  };
}

function computeStatusCounts(
  logs: TransactionLogItem[]
): Record<TransactionLogStatus, number> {
  const counts: Record<TransactionLogStatus, number> = {
    RECORDED: 0,
    SENT_TO_PHONE: 0,
    IGNORED_PROMO: 0,
    FAILED: 0,
  };
  for (const log of logs) {
    counts[log.status] += 1;
  }
  return counts;
}

function computeAverageGeminiLatency(logs: TransactionLogItem[]): number {
  let total = 0;
  let count = 0;
  for (const log of logs) {
    if (typeof log.latencyMs === "number" && Number.isFinite(log.latencyMs) && log.latencyMs > 0) {
      total += log.latencyMs;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.round(total / count);
}

function computePromoFilterRate(
  logs: TransactionLogItem[],
  counts: Record<TransactionLogStatus, number>
): number {
  if (logs.length === 0) {
    return 0;
  }
  return Math.round((counts.IGNORED_PROMO / logs.length) * 1000) / 10;
}

function computeUiSuccessRate(
  counts: Record<TransactionLogStatus, number>
): number {
  const totalDispatched =
    counts.RECORDED + counts.SENT_TO_PHONE + counts.FAILED;
  if (totalDispatched === 0) {
    return 0;
  }
  return Math.round((counts.RECORDED / totalDispatched) * 1000) / 10;
}

function parseDateBoundary(value: string, endOfDay: boolean): number | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`
    : value;
  const parsedMs = Date.parse(normalized);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

async function safeRecordApiLatency(durationMs: number): Promise<void> {
  if (!isRedisConfigured()) {
    return;
  }
  try {
    await recordApiLatencySample(durationMs);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof ExternalServiceError) {
      logger.warn("api_latency_sample_failed", {
        code: err.code,
        message: err.message,
      });
      return;
    }
    throw err;
  }
}

async function safeSendTelegramText(
  chatId: string | number,
  text: string
): Promise<void> {
  try {
    await sendTelegramMessage({ chatId, text });
  } catch (err) {
    if (err instanceof ConfigError || err instanceof ExternalServiceError) {
      logger.warn("telegram_reply_failed", {
        chatId: String(chatId),
        code: err.code,
        message: err.message,
      });
      return;
    }
    throw err;
  }
}

async function dispatchAndRecordOutcome(
  log: TransactionLogItem,
  parsedData: ParsedTransactionData,
  baseLatencyMs: number
): Promise<{ ok: boolean; log: TransactionLogItem; errorMessage?: string }> {
  const payload = buildMacrodroidPayload(log, parsedData);
  let dispatchOk = false;
  let dispatchLatencyMs = 0;
  let errorMessage: string | undefined;

  try {
    const result = await dispatchToMacrodroid(payload);
    dispatchOk = result.ok;
    dispatchLatencyMs = result.latencyMs;
    errorMessage = result.ok ? undefined : result.errorMessage;
  } catch (err) {
    if (err instanceof ConfigError || err instanceof ExternalServiceError) {
      logger.error("macrodroid_dispatch_error", err, { logId: log.id });
      dispatchOk = false;
      errorMessage = err.message;
    } else {
      throw err;
    }
  }

  const totalLatencyMs = baseLatencyMs + dispatchLatencyMs;
  if (!dispatchOk) {
    const failedLog = await updateTransactionLog(log.id, {
      status: "FAILED",
      errorMessage: errorMessage ?? "MacroDroid dispatch failed",
      latencyMs: totalLatencyMs,
    });
    return {
      ok: false,
      log: failedLog ?? {
        ...log,
        status: "FAILED",
        errorMessage: errorMessage ?? "MacroDroid dispatch failed",
        latencyMs: totalLatencyMs,
      },
      errorMessage,
    };
  }

  // Only update latencyMs so a fast concurrent ACK setting status=RECORDED is never overwritten
  const updatedLog = await updateTransactionLog(log.id, {
    latencyMs: totalLatencyMs,
  });
  return {
    ok: true,
    log: updatedLog ?? { ...log, latencyMs: totalLatencyMs },
  };
}

async function retryExistingTransactionLog(
  existing: TransactionLogItem,
  parsedData: ParsedTransactionData
): Promise<{ ok: boolean; log: TransactionLogItem; errorMessage?: string }> {
  const nextRetryCount = (existing.retryCount ?? 0) + 1;
  await updateTransactionLog(existing.id, {
    status: "SENT_TO_PHONE",
    retryCount: nextRetryCount,
    errorMessage: undefined,
  });

  return dispatchAndRecordOutcome(
    { ...existing, status: "SENT_TO_PHONE", retryCount: nextRetryCount },
    parsedData,
    existing.latencyMs
  );
}

async function sendTransactionReportSafe(
  chatId: string | number,
  log: TransactionLogItem
): Promise<TransactionLogItem> {
  try {
    const report = formatTransactionReport(log);
    const sent = await sendTelegramMessage({
      chatId,
      text: report.text,
      replyMarkup: report.replyMarkup,
      ...(log.telegramMessageId !== undefined
        ? { replyToMessageId: log.telegramMessageId }
        : {}),
    });
    const updated = await updateTransactionLog(log.id, {
      telegramChatId: String(chatId),
      telegramMessageId: sent.messageId,
    });
    return updated ?? log;
  } catch (err) {
    if (err instanceof ConfigError || err instanceof ExternalServiceError) {
      logger.warn("telegram_report_send_failed", {
        logId: log.id,
        code: err.code,
        message: err.message,
      });
      return log;
    }
    throw err;
  }
}

async function persistAndDispatchExtraction(params: {
  extraction: GeminiExtractionResult;
  source: TransactionLogSource;
  rawInput: string;
  appName?: string;
  appPackage?: string;
  telegramChatId?: string;
  telegramMessageId?: number;
  reportChatId?: string | number;
}): Promise<{ ignored: boolean; reason?: string; logs: TransactionLogItem[] }> {
  const {
    extraction,
    source,
    rawInput,
    appName,
    appPackage,
    telegramChatId,
    telegramMessageId,
    reportChatId,
  } = params;

  if (extraction.ignore) {
    const ignoredLog: TransactionLogItem = {
      id: randomUUID(),
      timestamp: nowJakartaIso(),
      source,
      appName,
      appPackage,
      rawInput,
      status: "IGNORED_PROMO",
      latencyMs: extraction.latencyMs,
      errorMessage: extraction.reason || undefined,
      telegramChatId,
      telegramMessageId,
    };
    await saveTransactionLog(ignoredLog);
    return { ignored: true, reason: extraction.reason, logs: [ignoredLog] };
  }

  if (extraction.transactions.length === 0) {
    const emptyLog: TransactionLogItem = {
      id: randomUUID(),
      timestamp: nowJakartaIso(),
      source,
      appName,
      appPackage,
      rawInput,
      status: "FAILED",
      latencyMs: extraction.latencyMs,
      errorMessage: "No transactions extracted by AI",
      telegramChatId,
      telegramMessageId,
    };
    await saveTransactionLog(emptyLog);
    return { ignored: false, logs: [emptyLog] };
  }

  const correlationGroupId = randomUUID();
  const createdLogs: TransactionLogItem[] = [];

  for (let txIndex = 0; txIndex < extraction.transactions.length; txIndex += 1) {
    const tx = extraction.transactions[txIndex];
    const parsedData: ParsedTransactionData = {
      type: tx.type,
      account: tx.account,
      category: tx.category,
      subcategory: tx.subcategory,
      amount: tx.amount,
      currency: tx.currency,
      note: tx.note,
      description: tx.description,
    };

    const initialLog: TransactionLogItem = {
      id: randomUUID(),
      correlationGroupId,
      txIndex,
      timestamp: nowJakartaIso(),
      source,
      appName,
      appPackage,
      rawInput,
      status: "SENT_TO_PHONE",
      latencyMs: extraction.latencyMs,
      parsedData,
      hierarchyAdjusted: tx.hierarchyAdjusted || undefined,
      telegramChatId,
      telegramMessageId,
      retryCount: 0,
    };

    // Persist before dispatch so fast MacroDroid ACKs always locate the log entry
    await saveTransactionLog(initialLog);

    const outcome = await dispatchAndRecordOutcome(
      initialLog,
      parsedData,
      extraction.latencyMs
    );
    let finalLog = outcome.log;

    if (reportChatId !== undefined && String(reportChatId).trim().length > 0) {
      finalLog = await sendTransactionReportSafe(reportChatId, finalLog);
    }
    createdLogs.push(finalLog);
  }

  return { ignored: false, logs: createdLogs };
}

const app = new Hono().basePath("/api");

app.onError((err, c) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error("api_app_error", err, {
        path: c.req.path,
        method: c.req.method,
      });
    } else {
      logger.warn("api_client_error", {
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
        path: c.req.path,
        method: c.req.method,
      });
    }
    return c.json<ApiErrorResponse>(
      { ok: false, error: err.message, code: err.code },
      toContentfulStatusCode(err.statusCode)
    );
  }

  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      logger.error("api_http_exception", err, {
        status: err.status,
        path: c.req.path,
      });
    } else {
      logger.warn("api_http_exception", {
        status: err.status,
        message: err.message,
        path: c.req.path,
      });
    }
    return c.json<ApiErrorResponse>(
      { ok: false, error: err.message || "Request error", code: "HTTP_ERROR" },
      toContentfulStatusCode(err.status)
    );
  }

  logger.error("api_unhandled_error", err, {
    path: c.req.path,
    method: c.req.method,
  });
  return c.json<ApiErrorResponse>(
    { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
    500
  );
});

app.notFound((c) => {
  return c.json<ApiErrorResponse>(
    { ok: false, error: "Endpoint not found", code: "NOT_FOUND" },
    404
  );
});

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  const durationMs = Math.max(0, Date.now() - startedAt);
  c.res.headers.set("X-Response-Time", `${durationMs}ms`);
  await safeRecordApiLatency(durationMs);
});

const routes = app
  .post(
    "/auth/login",
    zValidator("json", LoginSchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const { passcode } = c.req.valid("json");
      if (!verifyDashboardPasscode(passcode)) {
        logger.warn("auth_login_failed", { reason: "invalid_passcode" });
        throw new AuthError("Invalid passcode");
      }

      const session = createSessionToken();
      setCookie(c, SESSION_COOKIE_NAME, session.token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: shouldUseSecureCookie(c),
        path: "/",
        maxAge: session.maxAgeSeconds,
      });

      logger.info("auth_login_success");
      return c.json<AuthSessionResponse>(
        {
          authenticated: true,
          expiresAt: session.expiresAt,
        },
        200
      );
    }
  )
  .post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookie(c),
    });
    return c.json({ ok: true as const }, 200);
  })
  .get("/auth/session", (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    const session = verifySessionToken(token);
    if (!session.valid) {
      return c.json<AuthSessionResponse>({ authenticated: false }, 200);
    }
    return c.json<AuthSessionResponse>(
      {
        authenticated: true,
        expiresAt: session.expiresAt,
      },
      200
    );
  })
  .post(
    "/webhook/macrodroid",
    requireMacrodroidAuth,
    zValidator("json", MacrodroidWebhookSchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const payload = c.req.valid("json");
      await recordDeviceHeartbeat("WEBHOOK", {
        appName: payload.app_name || undefined,
        deviceModel: payload.device_model,
        batteryLevel: payload.battery_level,
      });

      const dedupeDigest = createHash("sha256")
        .update(`${payload.app_package}\0${payload.title}\0${payload.text}`)
        .digest("hex");
      const claimed = await claimIdempotencyKey(
        `macrodroid:${dedupeDigest}`,
        MACRODROID_DEDUPE_TTL_SECONDS
      );
      if (!claimed) {
        logger.info("macrodroid_webhook_deduplicated", {
          appPackage: payload.app_package,
          appName: payload.app_name,
        });
        return c.json(
          { ok: true, deduplicated: true, logs: [] as TransactionLogItem[] },
          200
        );
      }

      const rawParts = [payload.title, payload.text].filter(
        (part) => part.length > 0
      );
      const rawInput = rawParts.join(" | ");
      const startedAt = Date.now();

      let extraction: GeminiExtractionResult;
      try {
        extraction = await extractTransactionsFromText({
          text: payload.text,
          title: payload.title || undefined,
          appName: payload.app_name || undefined,
          appPackage: payload.app_package || undefined,
        });
      } catch (err) {
        if (err instanceof ExternalServiceError) {
          const failedLog: TransactionLogItem = {
            id: randomUUID(),
            timestamp: nowJakartaIso(),
            source: "MACRODROID",
            appName: payload.app_name || undefined,
            appPackage: payload.app_package || undefined,
            rawInput,
            status: "FAILED",
            latencyMs: Math.max(0, Date.now() - startedAt),
            errorMessage: err.message,
          };
          await saveTransactionLog(failedLog);
          throw err;
        }
        throw err;
      }

      const primaryAllowedChatId = process.env.ALLOWED_CHAT_ID?.split(",")
        .map((entry) => entry.trim())
        .find((entry) => entry.length > 0);
      const result = await persistAndDispatchExtraction({
        extraction,
        source: "MACRODROID",
        rawInput,
        appName: payload.app_name || undefined,
        appPackage: payload.app_package || undefined,
        reportChatId: primaryAllowedChatId || undefined,
      });

      return c.json(
        {
          ok: true,
          deduplicated: false,
          ignored: result.ignored,
          reason: result.reason,
          logs: result.logs,
        },
        200
      );
    }
  )
  .post(
    "/webhook/telegram",
    requireTelegramAuth,
    zValidator("json", TelegramUpdateSchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const update = c.req.valid("json");
      const claimed = await claimIdempotencyKey(
        `telegram:update:${update.update_id}`,
        TELEGRAM_UPDATE_DEDUPE_TTL_SECONDS
      );
      if (!claimed) {
        logger.info("telegram_update_deduplicated", {
          updateId: update.update_id,
        });
        return c.json({ ok: true, deduplicated: true }, 200);
      }

      if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const chatId = callbackQuery.message?.chat.id ?? callbackQuery.from.id;

        if (!isAllowedTelegramChat(chatId)) {
          logger.warn("telegram_callback_unauthorized_chat", {
            updateId: update.update_id,
            chatId: String(chatId),
            fromId: String(callbackQuery.from.id),
          });
          return c.json({ ok: true, ignored: "unauthorized" as const }, 200);
        }

        const callbackData = callbackQuery.data?.trim() ?? "";
        if (!callbackData.startsWith("retry:")) {
          await answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "Aksi tidak dikenali.",
          });
          return c.json({ ok: true, ignored: "unknown_callback" as const }, 200);
        }

        const logId = callbackData.slice("retry:".length).trim();
        const existingLog = await getTransactionLogById(logId);
        if (!existingLog || !existingLog.parsedData) {
          await answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "Log transaksi tidak ditemukan.",
            showAlert: true,
          });
          return c.json({ ok: true, retried: false, logId }, 200);
        }

        const outcome = await retryExistingTransactionLog(
          existingLog,
          existingLog.parsedData
        );

        await answerCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: outcome.ok
            ? "Berhasil dikirim ulang ke HP."
            : "Gagal mengirim ulang ke MacroDroid.",
          showAlert: !outcome.ok,
        });

        return c.json({ ok: true, retried: outcome.ok, logId }, 200);
      }

      if (update.message) {
        const message = update.message;
        const chatId = message.chat.id;

        if (!isAllowedTelegramChat(chatId)) {
          logger.warn("telegram_message_unauthorized_chat", {
            updateId: update.update_id,
            chatId: String(chatId),
            fromId: message.from ? String(message.from.id) : undefined,
          });
          return c.json({ ok: true, ignored: "unauthorized" as const }, 200);
        }

        const trimmedText = message.text?.trim() ?? "";
        if (trimmedText === "/start" || trimmedText === "/help") {
          await safeSendTelegramText(
            chatId,
            'Kirim teks transaksi (contoh: "kopi kenangan 28rb jago") atau foto struk belanja untuk dicatat otomatis ke Money Manager.'
          );
          return c.json({ ok: true, command: trimmedText }, 200);
        }

        let source: TransactionLogSource;
        let rawInput: string;
        const startedAt = Date.now();
        let extraction: GeminiExtractionResult;

        try {
          if (message.photo && message.photo.length > 0) {
            const bestPhoto = message.photo[message.photo.length - 1];
            source = "TELEGRAM_OCR";
            rawInput = message.caption?.trim()
              ? `[Photo OCR] ${message.caption.trim()}`
              : `[Photo OCR: ${bestPhoto.file_id}]`;
            const file = await downloadTelegramFile(bestPhoto.file_id);
            extraction = await extractTransactionsFromImage({
              base64Data: file.base64Data,
              mimeType: file.mimeType,
              caption: message.caption?.trim(),
            });
          } else if (
            message.document &&
            message.document.mime_type?.startsWith("image/")
          ) {
            source = "TELEGRAM_OCR";
            const fileLabel = message.document.file_name ?? message.document.file_id;
            rawInput = message.caption?.trim()
              ? `[Document OCR: ${fileLabel}] ${message.caption.trim()}`
              : `[Document OCR: ${fileLabel}]`;
            const file = await downloadTelegramFile(message.document.file_id);
            extraction = await extractTransactionsFromImage({
              base64Data: file.base64Data,
              mimeType: file.mimeType,
              caption: message.caption?.trim(),
            });
          } else if (trimmedText.length > 0) {
            source = "TELEGRAM_TEXT";
            rawInput = trimmedText;
            extraction = await extractTransactionsFromText(trimmedText);
          } else {
            await safeSendTelegramText(
              chatId,
              "Format pesan belum didukung. Kirim teks transaksi atau foto struk belanja."
            );
            return c.json(
              { ok: true, ignored: "unsupported_message" as const },
              200
            );
          }
        } catch (err) {
          if (
            err instanceof ExternalServiceError ||
            (err instanceof AppError && !(err instanceof ConfigError))
          ) {
            const failedLog: TransactionLogItem = {
              id: randomUUID(),
              timestamp: nowJakartaIso(),
              source:
                message.photo?.length || message.document
                  ? "TELEGRAM_OCR"
                  : "TELEGRAM_TEXT",
              rawInput:
                trimmedText ||
                message.caption?.trim() ||
                "[Telegram Attachment]",
              status: "FAILED",
              latencyMs: Math.max(0, Date.now() - startedAt),
              errorMessage: err.message,
              telegramChatId: String(chatId),
              telegramMessageId: message.message_id,
            };
            await saveTransactionLog(failedLog);
            await safeSendTelegramText(
              chatId,
              `Gagal memproses transaksi: ${err.message}`
            );
            // Return 200 so Telegram does not retry-storm transient OCR/AI failures
            return c.json({ ok: true, failed: true, logId: failedLog.id }, 200);
          }
          throw err;
        }

        const result = await persistAndDispatchExtraction({
          extraction,
          source,
          rawInput,
          telegramChatId: String(chatId),
          telegramMessageId: message.message_id,
          reportChatId: chatId,
        });

        if (result.ignored) {
          await safeSendTelegramText(
            chatId,
            `Diabaikan: ${result.reason || "Bukan transaksi keuangan."}`
          );
        }

        return c.json(
          {
            ok: true,
            ignored: result.ignored,
            logs: result.logs,
          },
          200
        );
      }

      return c.json({ ok: true, ignored: "no_supported_payload" as const }, 200);
    }
  )
  .post(
    "/webhook/ack",
    requireMacrodroidAuth,
    zValidator("json", MacrodroidAckSchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const payload = c.req.valid("json");
      await recordDeviceHeartbeat("ACK", {
        batteryLevel: payload.battery_level,
        deviceModel: payload.device_model,
      });

      const existing = await getTransactionLogById(payload.log_id);
      if (!existing) {
        logger.warn("macrodroid_ack_log_not_found", { logId: payload.log_id });
        return c.json<ApiErrorResponse>(
          { ok: false, error: "Transaction log not found", code: "NOT_FOUND" },
          404
        );
      }

      const ackedAt = payload.acked_at ?? nowJakartaIso();
      const updated = await updateTransactionLog(payload.log_id, {
        status: payload.status,
        ackedAt,
        errorMessage:
          payload.status === "FAILED"
            ? payload.error_message || "MacroDroid UI automation failed"
            : undefined,
      });

      return c.json({ ok: true, log: updated ?? existing }, 200);
    }
  )
  .get("/health", requireAuth, async (c) => {
    const fallbackHeartbeat: DeviceHeartbeat = {
      lastSeenAt: null,
      isOnline: false,
      secondsSinceLastSeen: null,
    };

    const [
      redisHealth,
      geminiHealth,
      telegramHealth,
      heartbeat,
      logs,
      avgApiLatencyMs,
    ] = await Promise.all([
      checkRedisHealth().catch((err: unknown): RedisHealthMetrics => {
        if (err instanceof ConfigError || err instanceof ExternalServiceError) {
          return {
            status: "ERROR",
            latencyMs: 0,
            totalLogs: 0,
            errorMessage: err.message,
          };
        }
        throw err;
      }),
      checkGeminiHealth().catch((err: unknown): GeminiHealthMetrics => {
        if (err instanceof ConfigError || err instanceof ExternalServiceError) {
          return {
            status: "ERROR",
            model: "gemini-2.5-flash",
            avgLatencyMs: 0,
            promoFilterRate: 0,
            errorMessage: err.message,
          };
        }
        throw err;
      }),
      getTelegramWebhookHealth().catch((err: unknown): TelegramHealthMetrics => {
        if (err instanceof ConfigError || err instanceof ExternalServiceError) {
          return {
            status: "ERROR",
            webhookActive: false,
            pendingUpdateCount: 0,
            errorMessage: err.message,
          };
        }
        throw err;
      }),
      getDeviceHeartbeat().catch((err: unknown): DeviceHeartbeat => {
        if (err instanceof ConfigError || err instanceof ExternalServiceError) {
          return fallbackHeartbeat;
        }
        throw err;
      }),
      getTransactionLogs(500).catch((err: unknown): TransactionLogItem[] => {
        if (err instanceof ConfigError || err instanceof ExternalServiceError) {
          return [];
        }
        throw err;
      }),
      getAverageApiLatencyMs().catch((err: unknown): number => {
        if (err instanceof ConfigError || err instanceof ExternalServiceError) {
          return 0;
        }
        throw err;
      }),
    ]);

    const statusCounts = computeStatusCounts(logs);
    const avgGeminiLatencyMs = computeAverageGeminiLatency(logs);
    const promoFilterRate = computePromoFilterRate(logs, statusCounts);
    const uiSuccessRate = computeUiSuccessRate(statusCounts);

    let overallStatus: SystemOverallStatus = "HEALTHY";
    if (redisHealth.status === "ERROR") {
      overallStatus = "DOWN";
    } else if (
      geminiHealth.status !== "ONLINE" ||
      telegramHealth.status !== "ONLINE"
    ) {
      overallStatus = "DEGRADED";
    }

    const response: HealthResponse = {
      ok: overallStatus !== "DOWN",
      overallStatus,
      checkedAt: nowJakartaIso(),
      runtime: {
        status: avgApiLatencyMs > 3000 ? "DEGRADED" : "ONLINE",
        region: process.env.VERCEL_REGION?.trim() || "local",
        avgApiLatencyMs,
      },
      redis: redisHealth,
      gemini: {
        ...geminiHealth,
        avgLatencyMs: avgGeminiLatencyMs,
        promoFilterRate,
      },
      telegram: telegramHealth,
      device: {
        heartbeat,
        uiSuccessRate,
        statusCounts,
      },
    };

    return c.json<HealthResponse>(response, 200);
  })
  .get(
    "/logs",
    requireAuth,
    zValidator("query", LogsQuerySchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const query = c.req.valid("query");
      const allLogs = await getTransactionLogs(500);
      const statusCounts = computeStatusCounts(allLogs);
      const matchingLogs =
        query.status === "ALL"
          ? allLogs
          : allLogs.filter((log) => log.status === query.status);

      const response: LogsResponse = {
        ok: true,
        logs: matchingLogs.slice(0, query.limit),
        total: matchingLogs.length,
        statusCounts,
        fetchedAt: nowJakartaIso(),
      };

      return c.json<LogsResponse>(response, 200);
    }
  )
  .get(
    "/logs/export",
    requireAuth,
    zValidator("query", ExportQuerySchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const query = c.req.valid("query");

      let fromMs: number | null = null;
      if (query.from) {
        fromMs = parseDateBoundary(query.from, false);
        if (fromMs === null) {
          return c.json<ApiErrorResponse>(
            { ok: false, error: "Invalid 'from' date parameter", code: "VALIDATION_ERROR" },
            400
          );
        }
      }

      let toMs: number | null = null;
      if (query.to) {
        toMs = parseDateBoundary(query.to, true);
        if (toMs === null) {
          return c.json<ApiErrorResponse>(
            { ok: false, error: "Invalid 'to' date parameter", code: "VALIDATION_ERROR" },
            400
          );
        }
      }

      const allLogs = await getTransactionLogs(EXPORT_MAX_FETCH_LIMIT);

      const filteredLogs = allLogs
        .filter((log) => {
          if (query.status !== "ALL" && log.status !== query.status) {
            return false;
          }
          if (fromMs !== null || toMs !== null) {
            const logMs = Date.parse(log.timestamp);
            if (!Number.isFinite(logMs)) {
              return false;
            }
            if (fromMs !== null && logMs < fromMs) {
              return false;
            }
            if (toMs !== null && logMs > toMs) {
              return false;
            }
          }
          return true;
        })
        .slice(0, query.limit);

      const buffer = await buildRealbyteWorkbookBuffer(filteredLogs);
      const dateStamp = nowJakartaIso().slice(0, 10);

      return c.body(new Uint8Array(buffer), 200, {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="money-manager-backup-${dateStamp}.xlsx"`,
        "Cache-Control": "no-store",
      });
    }
  )
  .post(
    "/logs/:id/retry",
    requireAuth,
    zValidator("param", RetryParamsSchema, (result, c) => {
      if (!result.success) {
        return validationErrorResponse(c, result.error.issues);
      }
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const existing = await getTransactionLogById(id);
      if (!existing) {
        return c.json<ApiErrorResponse>(
          { ok: false, error: "Transaction log not found", code: "NOT_FOUND" },
          404
        );
      }

      if (!existing.parsedData) {
        return c.json<ApiErrorResponse>(
          {
            ok: false,
            error: "Cannot retry a log without parsed transaction data",
            code: "INVALID_STATE",
          },
          400
        );
      }

      const outcome = await retryExistingTransactionLog(
        existing,
        existing.parsedData
      );

      const response: RetryResponse = {
        ok: outcome.ok,
        log: outcome.log,
        message: outcome.ok
          ? "Dispatched to MacroDroid"
          : outcome.errorMessage || "MacroDroid dispatch failed",
      };

      return c.json<RetryResponse>(response, 200);
    }
  )
  .post("/device/ping", requireAuth, async (c) => {
    const pingResult = await pingMacrodroid();
    if (pingResult.reachable && isRedisConfigured()) {
      try {
        await recordDeviceHeartbeat("PING");
      } catch (err) {
        if (err instanceof ExternalServiceError) {
          logger.warn("device_ping_heartbeat_failed", {
            code: err.code,
            message: err.message,
          });
        } else {
          throw err;
        }
      }
    }
    return c.json<PingResponse>(pingResult, 200);
  });

export type AppType = typeof routes;

export const GET = handle(routes);
export const POST = handle(routes);
export const PUT = handle(routes);
export const DELETE = handle(routes);
export const PATCH = handle(routes);
