import type {
  AccountName,
  CategoryName,
  CurrencyCode,
  SubcategoryName,
  TransactionType,
} from "./enums";

export type TransactionLogStatus =
  | "RECORDED"
  | "SENT_TO_PHONE"
  | "IGNORED_PROMO"
  | "FAILED";

export type TransactionLogSource =
  | "MACRODROID"
  | "TELEGRAM_TEXT"
  | "TELEGRAM_OCR";

export type LogFilterTab = "ALL" | TransactionLogStatus;

export interface ParsedTransactionData {
  type: TransactionType;
  account: AccountName;
  category: CategoryName;
  subcategory: SubcategoryName;
  amount: number;
  currency: CurrencyCode;
  note: string;
  description: string;
}

export interface TransactionLogItem {
  id: string;
  correlationGroupId?: string;
  txIndex?: number;
  timestamp: string;
  source: TransactionLogSource;
  appName?: string;
  appPackage?: string;
  rawInput: string;
  status: TransactionLogStatus;
  latencyMs: number;
  parsedData?: ParsedTransactionData;
  errorMessage?: string;
  hierarchyAdjusted?: boolean;
  telegramChatId?: string;
  telegramMessageId?: number;
  ackedAt?: string;
  retryCount?: number;
}

export interface DeviceHeartbeat {
  lastSeenAt: string | null;
  isOnline: boolean;
  secondsSinceLastSeen: number | null;
  lastEvent?: "WEBHOOK" | "ACK" | "PING";
  appName?: string;
  deviceModel?: string;
  batteryLevel?: number;
}

export interface RuntimeHealthMetrics {
  status: "ONLINE" | "DEGRADED";
  region: string;
  avgApiLatencyMs: number;
}

export interface RedisHealthMetrics {
  status: "ONLINE" | "ERROR";
  latencyMs: number;
  totalLogs: number;
  errorMessage?: string;
}

export interface GeminiHealthMetrics {
  status: "ONLINE" | "DEGRADED" | "ERROR";
  model: string;
  avgLatencyMs: number;
  /** Percentage from 0 to 100. */
  promoFilterRate: number;
  errorMessage?: string;
}

export interface TelegramHealthMetrics {
  status: "ONLINE" | "DEGRADED" | "ERROR";
  webhookActive: boolean;
  pendingUpdateCount: number;
  botUsername?: string;
  errorMessage?: string;
}

export interface DeviceSyncHealthMetrics {
  heartbeat: DeviceHeartbeat;
  /** Percentage from 0 to 100. */
  uiSuccessRate: number;
  statusCounts: Record<TransactionLogStatus, number>;
}

export type SystemOverallStatus = "HEALTHY" | "DEGRADED" | "DOWN";

export interface HealthMetricsSummary {
  overallStatus: SystemOverallStatus;
  checkedAt: string;
  runtime: RuntimeHealthMetrics;
  redis: RedisHealthMetrics;
  gemini: GeminiHealthMetrics;
  telegram: TelegramHealthMetrics;
  device: DeviceSyncHealthMetrics;
}
