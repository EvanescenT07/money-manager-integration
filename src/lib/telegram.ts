import type {
  TelegramHealthMetrics,
  TransactionLogItem,
} from "@/types/logs";
import { timingSafeCompare } from "./auth";
import { AppError, ConfigError, ExternalServiceError } from "./errors";
import { logger } from "./logger";
import { formatJakartaTimeHHmmss } from "./time";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_API_TIMEOUT_MS = 8_000;
const TELEGRAM_FILE_TIMEOUT_MS = 15_000;
const MAX_TELEGRAM_FILE_BYTES = 10 * 1024 * 1024;

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramSendMessageResult {
  message_id: number;
}

interface TelegramGetFileResult {
  file_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramGetMeResult {
  id: number;
  is_bot: boolean;
  username?: string;
}

interface TelegramWebhookInfoResult {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}

function getTelegramToken(): string {
  const token = process.env.TELEGRAM_TOKEN?.trim();
  if (!token) {
    throw new ConfigError("TELEGRAM_TOKEN environment variable is missing");
  }
  return token;
}

function isNarrowTelegramError(error: unknown): boolean {
  if (
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

async function callTelegramApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });

    const data = (await response.json()) as TelegramApiEnvelope<T>;
    if (!response.ok || !data.ok || data.result === undefined) {
      const description =
        data.description || `Telegram API ${method} HTTP ${response.status}`;
      throw new ExternalServiceError("TELEGRAM", description);
    }

    return data.result;
  } catch (err) {
    if (err instanceof ExternalServiceError) {
      logger.error("telegram.api_error", err, { method });
      throw err;
    }
    if (isNarrowTelegramError(err)) {
      logger.error("telegram.request_failed", err, { method });
      const message =
        err instanceof Error ? err.message : `Telegram ${method} failed`;
      throw new ExternalServiceError("TELEGRAM", message, err);
    }
    throw err;
  }
}

export function isAllowedTelegramChat(
  chatId: number | string | undefined | null
): boolean {
  const allowedRaw = process.env.ALLOWED_CHAT_ID?.trim();
  if (!allowedRaw || chatId === undefined || chatId === null) {
    return false;
  }

  const normalizedChatId = String(chatId).trim();
  if (!normalizedChatId) {
    return false;
  }

  const allowedIds = allowedRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return allowedIds.some((allowedId) =>
    timingSafeCompare(normalizedChatId, allowedId)
  );
}

export async function sendTelegramMessage(params: {
  chatId?: string | number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: TelegramInlineKeyboardMarkup;
  replyToMessageId?: number;
}): Promise<{ messageId: number }> {
  const token = getTelegramToken();
  const targetChatId =
    params.chatId !== undefined && params.chatId !== null
      ? String(params.chatId).trim()
      : process.env.ALLOWED_CHAT_ID?.split(",")[0]?.trim();

  if (!targetChatId) {
    throw new ConfigError(
      "Telegram target chatId or ALLOWED_CHAT_ID must be configured"
    );
  }

  const payload: Record<string, unknown> = {
    chat_id: targetChatId,
    text: params.text,
  };
  if (params.parseMode) {
    payload.parse_mode = params.parseMode;
  }
  if (params.replyMarkup) {
    payload.reply_markup = params.replyMarkup;
  }
  if (params.replyToMessageId !== undefined) {
    payload.reply_to_message_id = params.replyToMessageId;
  }

  const result = await callTelegramApi<TelegramSendMessageResult>(
    token,
    "sendMessage",
    payload
  );

  return { messageId: result.message_id };
}

export async function answerCallbackQuery(params: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}): Promise<void> {
  const token = getTelegramToken();
  await callTelegramApi<boolean>(token, "answerCallbackQuery", {
    callback_query_id: params.callbackQueryId,
    ...(params.text ? { text: params.text } : {}),
    ...(params.showAlert !== undefined ? { show_alert: params.showAlert } : {}),
  });
}

function detectImageMimeType(
  bytes: Uint8Array,
  headerContentType: string | null
): string | null {
  if (headerContentType) {
    const normalized = headerContentType.split(";")[0]?.trim().toLowerCase();
    if (
      normalized &&
      normalized !== "application/octet-stream" &&
      !normalized.startsWith("image/")
    ) {
      return null;
    }
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export async function downloadTelegramFile(fileId: string): Promise<{
  buffer: Buffer;
  base64Data: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
}> {
  if (!fileId || !fileId.trim()) {
    throw new AppError("Telegram file_id is required", 400, "INVALID_FILE_ID");
  }

  const token = getTelegramToken();
  const fileMeta = await callTelegramApi<TelegramGetFileResult>(
    token,
    "getFile",
    { file_id: fileId.trim() }
  );

  if (!fileMeta.file_path) {
    throw new ExternalServiceError(
      "TELEGRAM",
      "Telegram getFile response omitted file_path"
    );
  }

  if (
    fileMeta.file_size !== undefined &&
    fileMeta.file_size > MAX_TELEGRAM_FILE_BYTES
  ) {
    throw new AppError(
      "Telegram image exceeds 10MB size limit",
      400,
      "FILE_TOO_LARGE"
    );
  }

  const cleanFilePath = fileMeta.file_path.replace(/^\/+/, "");
  const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${token}/${cleanFilePath}`;
  try {
    const response = await fetch(downloadUrl, {
      method: "GET",
      signal: AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new ExternalServiceError(
        "TELEGRAM",
        `Telegram file download HTTP ${response.status}`
      );
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredSize = Number(contentLengthHeader);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_TELEGRAM_FILE_BYTES) {
        throw new AppError(
          "Telegram image exceeds 10MB size limit",
          400,
          "FILE_TOO_LARGE"
        );
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new AppError("Telegram image file is empty", 400, "EMPTY_FILE");
    }
    if (arrayBuffer.byteLength > MAX_TELEGRAM_FILE_BYTES) {
      throw new AppError(
        "Telegram image exceeds 10MB size limit",
        400,
        "FILE_TOO_LARGE"
      );
    }

    const bytes = new Uint8Array(arrayBuffer);
    const detectedMime = detectImageMimeType(
      bytes,
      response.headers.get("content-type")
    );
    if (!detectedMime) {
      throw new AppError(
        "Unsupported media type: expected JPEG, PNG, WEBP, or GIF image",
        400,
        "UNSUPPORTED_MEDIA_TYPE"
      );
    }

    const buffer = Buffer.from(arrayBuffer);
    return {
      buffer,
      base64Data: buffer.toString("base64"),
      mimeType: detectedMime,
      filePath: fileMeta.file_path,
      fileSize: buffer.byteLength,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    if (isNarrowTelegramError(err)) {
      logger.error("telegram.file_download_failed", err);
      const message =
        err instanceof Error ? err.message : "Telegram file download failed";
      throw new ExternalServiceError("TELEGRAM", message, err);
    }
    throw err;
  }
}

export async function getTelegramWebhookHealth(): Promise<TelegramHealthMetrics> {
  const token = process.env.TELEGRAM_TOKEN?.trim();
  if (!token) {
    return {
      status: "ERROR",
      webhookActive: false,
      pendingUpdateCount: 0,
      errorMessage: "TELEGRAM_TOKEN is not configured",
    };
  }

  try {
    const [webhookInfo, botInfo] = await Promise.all([
      callTelegramApi<TelegramWebhookInfoResult>(token, "getWebhookInfo"),
      callTelegramApi<TelegramGetMeResult>(token, "getMe"),
    ]);

    const webhookActive = Boolean(webhookInfo.url && webhookInfo.url.length > 0);
    const hasWebhookError = Boolean(webhookInfo.last_error_message);
    const status =
      webhookActive && !hasWebhookError ? "ONLINE" : "DEGRADED";

    return {
      status,
      webhookActive,
      pendingUpdateCount: webhookInfo.pending_update_count ?? 0,
      ...(botInfo.username ? { botUsername: botInfo.username } : {}),
      ...(webhookInfo.last_error_message
        ? { errorMessage: webhookInfo.last_error_message }
        : {}),
    };
  } catch (err) {
    if (err instanceof ExternalServiceError || isNarrowTelegramError(err)) {
      logger.error("telegram.health_check_failed", err);
      return {
        status: "ERROR",
        webhookActive: false,
        pendingUpdateCount: 0,
        errorMessage:
          err instanceof Error
            ? err.message
            : "Telegram health check failed",
      };
    }
    throw err;
  }
}

export function formatTransactionReport(log: TransactionLogItem): {
  text: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
} {
  const timeWib = formatJakartaTimeHHmmss(log.timestamp);
  const replyMarkup: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: "Input Ulang ke HP",
          callback_data: `retry:${log.id}`,
        },
      ],
    ],
  };

  if (!log.parsedData) {
    const lines = [
      `[MM-AutoSync] ${log.status}`,
      `Source: ${log.source} (${timeWib} WIB)`,
      ...(log.errorMessage ? [`Reason: ${log.errorMessage}`] : []),
      `Log ID: ${log.id}`,
    ];
    return { text: lines.join("\n"), replyMarkup };
  }

  const formattedAmount = new Intl.NumberFormat("id-ID").format(
    log.parsedData.amount
  );
  const categoryLabel = log.parsedData.subcategory
    ? `${log.parsedData.category} > ${log.parsedData.subcategory}`
    : log.parsedData.category;

  const lines = [
    `[MM-AutoSync] ${log.parsedData.type} | Rp ${formattedAmount}`,
    `Account: ${log.parsedData.account}`,
    `Category: ${categoryLabel}`,
    `Note: ${log.parsedData.note}`,
    ...(log.parsedData.description
      ? [`Description: ${log.parsedData.description}`]
      : []),
    `Source: ${log.source} (${timeWib} WIB)`,
    `Status: ${log.status}`,
    ...(log.hierarchyAdjusted ? ["Hierarchy Adjusted: Yes"] : []),
    `Log ID: ${log.id}`,
  ];

  return {
    text: lines.join("\n"),
    replyMarkup,
  };
}
