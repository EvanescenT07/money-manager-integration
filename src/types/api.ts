import { z } from "zod";
import type {
  AccountName,
  CategoryName,
  CurrencyCode,
  SubcategoryName,
  TransactionType,
} from "./enums";
import type {
  HealthMetricsSummary,
  TransactionLogItem,
  TransactionLogSource,
  TransactionLogStatus,
} from "./logs";

export const MacrodroidWebhookSchema = z
  .object({
    app_package: z.string().trim().default(""),
    app_name: z.string().trim().default(""),
    title: z.string().trim().default(""),
    text: z.string().trim().default(""),
    battery_level: z.coerce.number().min(0).max(100).optional(),
    device_model: z.string().trim().optional(),
  })
  .refine((data) => data.title.length > 0 || data.text.length > 0, {
    message: "Either title or text must be non-empty",
  });
export type MacrodroidWebhookPayload = z.infer<typeof MacrodroidWebhookSchema>;

export const MacrodroidAckSchema = z.object({
  log_id: z.string().trim().min(1, "log_id is required"),
  status: z.enum(["RECORDED", "FAILED"]).default("RECORDED"),
  error_message: z.string().trim().optional(),
  acked_at: z.iso.datetime({ offset: true }).optional(),
  battery_level: z.coerce.number().min(0).max(100).optional(),
  device_model: z.string().trim().optional(),
});
export type MacrodroidAckPayload = z.infer<typeof MacrodroidAckSchema>;

export const LoginSchema = z.object({
  passcode: z.string().trim().min(1, "Passcode is required").max(64),
});
export type LoginPayload = z.infer<typeof LoginSchema>;

export const RetryParamsSchema = z.object({
  id: z.string().trim().min(1, "Log id is required"),
});
export type RetryParams = z.infer<typeof RetryParamsSchema>;

export const ExportQuerySchema = z.object({
  status: z
    .enum(["ALL", "RECORDED", "SENT_TO_PHONE", "IGNORED_PROMO", "FAILED"])
    .default("ALL"),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type ExportQuery = z.infer<typeof ExportQuerySchema>;

export const LogsQuerySchema = z.object({
  status: z
    .enum(["ALL", "RECORDED", "SENT_TO_PHONE", "IGNORED_PROMO", "FAILED"])
    .default("ALL"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type LogsQuery = z.infer<typeof LogsQuerySchema>;

/**
 * Payload dispatched to MacroDroid Webhook #2 to drive Money Manager UI input.
 */
export interface MacrodroidInputPayload {
  log_id: string;
  correlation_group_id?: string;
  tx_index?: number;
  type: TransactionType;
  account: AccountName;
  category: CategoryName;
  subcategory: SubcategoryName;
  amount: number;
  currency: CurrencyCode;
  note: string;
  description: string;
  source: TransactionLogSource;
  timestamp: string;
}

export interface HealthResponse extends HealthMetricsSummary {
  ok: boolean;
}

export interface LogsResponse {
  ok: boolean;
  logs: TransactionLogItem[];
  total: number;
  statusCounts: Record<TransactionLogStatus, number>;
  fetchedAt: string;
}

export interface PingResponse {
  ok: boolean;
  reachable: boolean;
  latencyMs: number;
  timestamp: string;
  message: string;
  errorMessage?: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  expiresAt?: string;
}

export interface RetryResponse {
  ok: boolean;
  log: TransactionLogItem;
  message: string;
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
  code?: string;
}
