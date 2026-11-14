"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { createApiClient } from "@/lib/rpc";
import type {
  ApiErrorResponse,
  HealthResponse,
  LogsResponse,
  PingResponse,
  RetryResponse,
} from "@/types/api";
import type {
  LogFilterTab,
  ParsedTransactionData,
  SystemOverallStatus,
  TransactionLogItem,
  TransactionLogSource,
  TransactionLogStatus,
} from "@/types/logs";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  ClockPendingIcon,
  CloseIcon,
  DownloadIcon,
  InspectCodeIcon,
  ListTelemetryIcon,
  LogoutIcon,
  MessageSquareIcon,
  ProcessorIcon,
  RefreshIcon,
  ScanReceiptIcon,
  ServerNodeIcon,
  ShieldBlockIcon,
  SignalWaveIcon,
  SmartphoneIcon,
  WebhookIcon,
} from "./icons";

class ApiFetchError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiFetchError";
    this.status = status;
  }
}

interface ActionNotice {
  tone: "success" | "warning" | "error";
  title: string;
  detail?: string;
}

interface DashboardViewProps {
  sessionExpiresAt?: string;
}

const LOG_STATUS_META: Record<
  TransactionLogStatus,
  {
    label: string;
    badgeClass: string;
  }
> = {
  RECORDED: {
    label: "Tercatat",
    badgeClass: "border-[#10B981] bg-[#0C231C] text-[#34D399]",
  },
  SENT_TO_PHONE: {
    label: "Menunggu HP",
    badgeClass: "border-[#F59E0B] bg-[#241908] text-[#FBBF24]",
  },
  IGNORED_PROMO: {
    label: "Diblokir",
    badgeClass: "border-[#64748B] bg-[#1E2530] text-[#CBD5E1]",
  },
  FAILED: {
    label: "Gagal",
    badgeClass: "border-[#F43F5E] bg-[#260E15] text-[#FB7185]",
  },
};

const OVERALL_STATUS_META: Record<
  SystemOverallStatus,
  {
    label: string;
    badgeClass: string;
  }
> = {
  HEALTHY: {
    label: "SYSTEM HEALTHY",
    badgeClass: "border-[#10B981] bg-[#0C231C] text-[#34D399]",
  },
  DEGRADED: {
    label: "SYSTEM DEGRADED",
    badgeClass: "border-[#F59E0B] bg-[#241908] text-[#FBBF24]",
  },
  DOWN: {
    label: "SYSTEM DOWN",
    badgeClass: "border-[#F43F5E] bg-[#260E15] text-[#FB7185]",
  },
};

const COMPONENT_STATUS_CLASS: Record<"ONLINE" | "DEGRADED" | "ERROR", string> = {
  ONLINE: "border-[#10B981] bg-[#0C231C] text-[#34D399]",
  DEGRADED: "border-[#F59E0B] bg-[#241908] text-[#FBBF24]",
  ERROR: "border-[#F43F5E] bg-[#260E15] text-[#FB7185]",
};

const SOURCE_LABELS: Record<TransactionLogSource, string> = {
  MACRODROID: "MacroDroid",
  TELEGRAM_TEXT: "Telegram Teks",
  TELEGRAM_OCR: "Telegram OCR",
};

const FILTER_TABS: ReadonlyArray<{ id: LogFilterTab; label: string }> = [
  { id: "ALL", label: "Semua Log" },
  { id: "RECORDED", label: "Tercatat (Expense/Income)" },
  { id: "SENT_TO_PHONE", label: "Menunggu Layar HP Dibuka" },
  { id: "IGNORED_PROMO", label: "Diblokir (Iklan/OTP)" },
  { id: "FAILED", label: "Gagal" },
];

const NOTICE_CONTAINER_CLASS: Record<ActionNotice["tone"], string> = {
  success: "border-[#10B981] bg-[#0C231C] text-[#34D399]",
  warning: "border-[#F59E0B] bg-[#241908] text-[#FBBF24]",
  error: "border-[#F43F5E] bg-[#260E15] text-[#FB7185]",
};

function formatIdr(amount: number): string {
  const rounded = Math.round(amount);
  return `Rp ${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(rounded)}`;
}

function formatJakartaTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatJakartaShortDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return "--/--";
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatJakartaDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${formatted} WIB`;
}

function formatRelativeAge(seconds: number | null): string {
  if (seconds === null || seconds < 0) {
    return "Belum ada sinyal";
  }
  if (seconds < 60) {
    return `${seconds} dtk lalu`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} mnt lalu`;
  }
  return `${Math.floor(seconds / 3600)} jam lalu`;
}

function formatCategoryPath(parsedData: ParsedTransactionData): string {
  if (!parsedData.subcategory) {
    return parsedData.category;
  }
  return `${parsedData.category} > ${parsedData.subcategory}`;
}

async function extractErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const payload = (await response
    .json()
    .catch(() => null)) as ApiErrorResponse | null;
  if (payload?.error) {
    return payload.error;
  }
  return `${fallbackMessage} (HTTP ${response.status})`;
}

async function fetchHealthTelemetry(): Promise<HealthResponse> {
  const client = createApiClient();
  const response = await client.api.health.$get();
  if (!response.ok) {
    const message = await extractErrorMessage(
      response,
      "Gagal memuat telemetry kesehatan sistem"
    );
    throw new ApiFetchError(response.status, message);
  }
  return (await response.json()) as HealthResponse;
}

async function fetchTransactionLogs(
  statusFilter: LogFilterTab
): Promise<LogsResponse> {
  const client = createApiClient();
  const response = await client.api.logs.$get({
    query: {
      status: statusFilter,
      limit: "100",
    },
  });
  if (!response.ok) {
    const message = await extractErrorMessage(
      response,
      "Gagal memuat riwayat log transaksi"
    );
    throw new ApiFetchError(response.status, message);
  }
  return (await response.json()) as LogsResponse;
}

function renderLogStatusIcon(status: TransactionLogStatus) {
  switch (status) {
    case "RECORDED":
      return <CheckCircleIcon size={14} />;
    case "SENT_TO_PHONE":
      return <ClockPendingIcon size={14} />;
    case "IGNORED_PROMO":
      return <ShieldBlockIcon size={14} />;
    case "FAILED":
      return <AlertCircleIcon size={14} />;
  }
}

function StatusBadge({ status }: { status: TransactionLogStatus }) {
  const meta = LOG_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${meta.badgeClass}`}
    >
      {renderLogStatusIcon(status)}
      <span>{meta.label}</span>
    </span>
  );
}

function renderSourceIcon(source: TransactionLogSource) {
  switch (source) {
    case "MACRODROID":
      return <SmartphoneIcon size={14} className="text-[#A8B3C2]" />;
    case "TELEGRAM_TEXT":
      return <MessageSquareIcon size={14} className="text-[#A8B3C2]" />;
    case "TELEGRAM_OCR":
      return <ScanReceiptIcon size={14} className="text-[#A8B3C2]" />;
  }
}

function SourceBadge({
  source,
  appName,
}: {
  source: TransactionLogSource;
  appName?: string;
}) {
  const label = appName?.trim() ? appName.trim() : SOURCE_LABELS[source];
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-[#64748B] bg-[#171C24] px-2 py-0.5 text-xs font-medium text-[#CBD5E1] whitespace-nowrap">
      {renderSourceIcon(source)}
      <span>{label}</span>
    </span>
  );
}

function renderComponentHealthIcon(status: "ONLINE" | "DEGRADED" | "ERROR") {
  switch (status) {
    case "ONLINE":
      return <CheckCircleIcon size={13} />;
    case "DEGRADED":
      return <AlertTriangleIcon size={13} />;
    case "ERROR":
      return <AlertCircleIcon size={13} />;
  }
}

function ComponentHealthBadge({
  status,
}: {
  status: "ONLINE" | "DEGRADED" | "ERROR";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs font-medium ${COMPONENT_STATUS_CLASS[status]}`}
    >
      {renderComponentHealthIcon(status)}
      <span>{status}</span>
    </span>
  );
}

function OverallHealthBadge({
  status,
}: {
  status: SystemOverallStatus | null;
}) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-[#64748B] bg-[#1E2530] px-2.5 py-1 font-mono text-xs font-medium text-[#CBD5E1]">
        <ClockPendingIcon size={14} />
        <span>MEMERIKSA SISTEM</span>
      </span>
    );
  }

  const meta = OVERALL_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs font-medium ${meta.badgeClass}`}
    >
      {status === "HEALTHY" ? (
        <CheckCircleIcon size={14} />
      ) : status === "DEGRADED" ? (
        <AlertTriangleIcon size={14} />
      ) : (
        <AlertCircleIcon size={14} />
      )}
      <span>{meta.label}</span>
    </span>
  );
}

function ActionNoticeBanner({
  notice,
  onDismiss,
}: {
  notice: ActionNotice;
  onDismiss: () => void;
}) {
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 ${NOTICE_CONTAINER_CLASS[notice.tone]}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {notice.tone === "success" ? (
          <CheckCircleIcon size={18} className="mt-0.5 shrink-0" />
        ) : notice.tone === "warning" ? (
          <AlertTriangleIcon size={18} className="mt-0.5 shrink-0" />
        ) : (
          <AlertCircleIcon size={18} className="mt-0.5 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{notice.title}</p>
          {notice.detail ? (
            <p className="mt-0.5 font-mono text-xs break-words">
              {notice.detail}
            </p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-current px-2 transition-colors hover:bg-black/25"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

function LogDetailModal({
  log,
  isRetrying,
  onClose,
  onRetry,
}: {
  log: TransactionLogItem;
  isRetrying: boolean;
  onClose: () => void;
  onRetry: (logId: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const sourceLabel = SOURCE_LABELS[log.source];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-detail-heading"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#64748B] bg-[#11151B]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#242B35] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={log.status} />
              <SourceBadge source={log.source} appName={log.appName} />
            </div>
            <h2
              id="log-detail-heading"
              className="mt-2.5 text-lg font-semibold text-[#F1F5F9]"
            >
              Inspeksi Payload & Ekstraksi Log
            </h2>
            <p className="mt-0.5 font-mono text-xs break-all text-[#94A3B8]">
              ID: {log.id}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup modal detail log"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-[#64748B] bg-[#171C24] text-[#CBD5E1] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9]"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-5">
          <dl className="grid grid-cols-1 gap-3 rounded-md border border-[#242B35] bg-[#171C24] p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[#94A3B8]">Waktu (WIB)</dt>
              <dd className="mt-0.5 font-mono text-sm text-[#F1F5F9]">
                {formatJakartaDateTime(log.timestamp)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#94A3B8]">Sumber & Paket</dt>
              <dd className="mt-0.5 font-mono text-sm break-all text-[#F1F5F9]">
                {sourceLabel}
                {log.appPackage ? ` (${log.appPackage})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#94A3B8]">Latency Pipeline</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-[#F1F5F9]">
                {log.latencyMs} ms
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#94A3B8]">Percobaan Retry / ACK</dt>
              <dd className="mt-0.5 font-mono text-sm text-[#F1F5F9]">
                {log.retryCount ?? 0}x retry
                {log.ackedAt ? ` / ACK ${formatJakartaTime(log.ackedAt)}` : ""}
              </dd>
            </div>
            {log.correlationGroupId ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-[#94A3B8]">Grup Split Transaksi</dt>
                <dd className="mt-0.5 font-mono text-xs break-all text-[#CBD5E1]">
                  {log.correlationGroupId} (item #{(log.txIndex ?? 0) + 1})
                </dd>
              </div>
            ) : null}
          </dl>

          {log.errorMessage ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-[#F43F5E] bg-[#260E15] p-3.5 text-sm text-[#FB7185]"
            >
              <AlertCircleIcon size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">Pesan Kesalahan</p>
                <p className="mt-1 font-mono text-xs break-words">
                  {log.errorMessage}
                </p>
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-medium tracking-wider text-[#A8B3C2] uppercase">
              Input Notifikasi / Pesan Asli
            </h3>
            <pre className="mt-2 overflow-x-auto rounded-md border border-[#242B35] bg-[#090B0E] p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[#F1F5F9]">
              {log.rawInput}
            </pre>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-wider text-[#A8B3C2] uppercase">
                Hasil Ekstraksi JSON (Gemini + Sanitasi Hirarki)
              </h3>
              {log.hierarchyAdjusted ? (
                <span className="rounded border border-[#F59E0B] bg-[#241908] px-2 py-0.5 font-mono text-xs text-[#FBBF24]">
                  Hirarki Disanitasi
                </span>
              ) : null}
            </div>
            {log.parsedData ? (
              <pre className="mt-2 overflow-x-auto rounded-md border border-[#242B35] bg-[#090B0E] p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[#34D399]">
                {JSON.stringify(log.parsedData, null, 2)}
              </pre>
            ) : (
              <p className="mt-2 rounded-md border border-[#242B35] bg-[#171C24] px-3.5 py-3 text-sm text-[#A8B3C2]">
                Tidak ada payload transaksi JSON karena pesan diabaikan oleh filter
                atau gagal diekstrak.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#242B35] bg-[#171C24] px-5 py-3.5">
          {log.parsedData ? (
            <button
              type="button"
              onClick={() => onRetry(log.id)}
              disabled={isRetrying}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-[#04120C] transition-colors hover:bg-[#34D399] disabled:cursor-not-allowed disabled:border disabled:border-[#64748B] disabled:bg-[#1E2530] disabled:text-[#94A3B8]"
            >
              <RefreshIcon size={16} />
              <span>
                {isRetrying ? "Mengirim ulang..." : "Retry Kirim ke HP"}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center rounded-md border border-[#64748B] bg-[#11151B] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530]"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ sessionExpiresAt }: DashboardViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LogFilterTab>("ALL");
  const [isPinging, setIsPinging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [selectedLog, setSelectedLog] = useState<TransactionLogItem | null>(
    null
  );
  const lastModalTriggerRef = useRef<HTMLButtonElement | null>(null);

  const {
    data: healthData,
    error: healthError,
    isLoading: healthLoading,
    mutate: mutateHealth,
  } = useSWR<HealthResponse, ApiFetchError>(
    "health-telemetry",
    fetchHealthTelemetry,
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
    }
  );

  const {
    data: logsData,
    error: logsError,
    isLoading: logsLoading,
    mutate: mutateLogs,
  } = useSWR<LogsResponse, ApiFetchError>(
    ["transaction-logs", activeTab],
    ([, tab]) => fetchTransactionLogs(tab as LogFilterTab),
    {
      refreshInterval: 10000,
      revalidateOnFocus: true,
    }
  );

  useEffect(() => {
    if (healthError?.status === 401 || logsError?.status === 401) {
      router.replace("/");
    }
  }, [healthError, logsError, router]);

  function openDetailModal(
    item: TransactionLogItem,
    triggerElement: HTMLButtonElement
  ) {
    lastModalTriggerRef.current = triggerElement;
    setSelectedLog(item);
  }

  function closeDetailModal() {
    setSelectedLog(null);
    window.requestAnimationFrame(() => {
      lastModalTriggerRef.current?.focus();
    });
  }

  async function handleRefreshAll() {
    setNotice(null);
    await Promise.all([mutateHealth(), mutateLogs()]);
  }

  async function handlePingDevice() {
    setIsPinging(true);
    setNotice(null);
    try {
      const client = createApiClient();
      const response = await client.api.device.ping.$post();

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const message = await extractErrorMessage(
          response,
          "Test ping ke HP gagal"
        );
        setNotice({
          tone: "error",
          title: "Test Ping ke HP gagal",
          detail: message,
        });
        return;
      }

      const payload = (await response.json()) as PingResponse;
      if (payload.reachable) {
        setNotice({
          tone: "success",
          title: `HP terjangkau (${payload.latencyMs} ms)`,
          detail: payload.message,
        });
      } else {
        setNotice({
          tone: "warning",
          title: `HP tidak merespons (${payload.latencyMs} ms)`,
          detail: payload.errorMessage ?? payload.message,
        });
      }
      await mutateHealth();
    } catch (error: unknown) {
      setNotice({
        tone: "error",
        title: "Test Ping ke HP gagal dijalankan",
        detail:
          error instanceof Error ? error.message : "Terjadi kesalahan jaringan.",
      });
    } finally {
      setIsPinging(false);
    }
  }

  async function handleExportXlsx() {
    setIsExporting(true);
    setNotice(null);
    try {
      const query = new URLSearchParams({
        status: activeTab,
        limit: "500",
      });
      const response = await fetch(`/api/logs/export?${query.toString()}`, {
        method: "GET",
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const message = await extractErrorMessage(
          response,
          "Gagal mengekspor file .XLSX"
        );
        setNotice({
          tone: "error",
          title: "Export Backup .XLSX gagal",
          detail: message,
        });
        return;
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] ?? "MM-AutoSync-Backup.xlsx";

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setNotice({
        tone: "success",
        title: `Backup berhasil diunduh (${filename})`,
        detail: `Format 11 kolom Realbyte Money Manager untuk filter: ${activeTab}.`,
      });
    } catch (error: unknown) {
      setNotice({
        tone: "error",
        title: "Export Backup .XLSX gagal",
        detail:
          error instanceof Error ? error.message : "Terjadi kesalahan jaringan.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleRetryLog(logId: string) {
    setRetryingId(logId);
    setNotice(null);
    try {
      const client = createApiClient();
      const response = await client.api.logs[":id"].retry.$post({
        param: { id: logId },
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const message = await extractErrorMessage(
          response,
          "Gagal mengirim ulang transaksi ke HP"
        );
        setNotice({
          tone: "error",
          title: `Retry gagal untuk log ${logId}`,
          detail: message,
        });
        return;
      }

      const payload = (await response.json()) as RetryResponse;
      setSelectedLog((current) =>
        current && current.id === payload.log.id ? payload.log : current
      );
      setNotice({
        tone: payload.log.status === "FAILED" ? "warning" : "success",
        title:
          payload.log.status === "FAILED"
            ? `Retry terkendala untuk log ${logId}`
            : `Transaksi dikirim ulang ke HP (${logId})`,
        detail: payload.message,
      });

      await Promise.all([mutateLogs(), mutateHealth()]);
    } catch (error: unknown) {
      setNotice({
        tone: "error",
        title: `Retry gagal untuk log ${logId}`,
        detail:
          error instanceof Error ? error.message : "Terjadi kesalahan jaringan.",
      });
    } finally {
      setRetryingId(null);
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      const client = createApiClient();
      const response = await client.api.auth.logout.$post();
      if (!response.ok) {
        console.warn("Logout endpoint returned non-OK status", response.status);
      }
    } catch (error: unknown) {
      console.warn("Logout request failed; redirecting to login", error);
    } finally {
      router.replace("/");
      router.refresh();
      setIsLoggingOut(false);
    }
  }

  const logs = logsData?.logs ?? [];
  const statusCounts =
    logsData?.statusCounts ??
    healthData?.device.statusCounts ?? {
      RECORDED: 0,
      SENT_TO_PHONE: 0,
      IGNORED_PROMO: 0,
      FAILED: 0,
    };
  const totalAllLogs =
    statusCounts.RECORDED +
    statusCounts.SENT_TO_PHONE +
    statusCounts.IGNORED_PROMO +
    statusCounts.FAILED;
  const actionableLogs =
    statusCounts.RECORDED + statusCounts.SENT_TO_PHONE + statusCounts.FAILED;

  return (
    <div className="min-h-dvh bg-[#090B0E] text-[#F1F5F9]">
      <header className="border-b border-[#242B35] bg-[#090B0E]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-base font-semibold tracking-tight text-[#F1F5F9]">
              MM-AutoSync
            </span>
            <OverallHealthBadge status={healthData?.overallStatus ?? null} />
            {healthData?.checkedAt ? (
              <span className="font-mono text-xs text-[#94A3B8]">
                Update {formatJakartaTime(healthData.checkedAt)} WIB
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handlePingDevice}
              disabled={isPinging}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-[#04120C] transition-colors hover:bg-[#34D399] disabled:cursor-not-allowed disabled:border disabled:border-[#64748B] disabled:bg-[#1E2530] disabled:text-[#94A3B8]"
            >
              <SignalWaveIcon size={16} />
              <span>{isPinging ? "Mengirim Ping..." : "Test Ping ke HP"}</span>
            </button>

            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={isExporting}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#64748B] bg-[#171C24] px-3.5 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] disabled:cursor-not-allowed disabled:text-[#94A3B8]"
            >
              <DownloadIcon size={16} />
              <span>
                {isExporting ? "Menyiapkan .XLSX..." : "Export Backup .XLSX"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleRefreshAll}
              aria-label="Muat ulang telemetry dan log"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[#64748B] bg-[#171C24] px-3 py-2 text-sm font-medium text-[#CBD5E1] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9]"
            >
              <RefreshIcon size={16} />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#64748B] bg-[#171C24] px-3.5 py-2 text-sm font-medium text-[#CBD5E1] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9] disabled:cursor-not-allowed"
            >
              <LogoutIcon size={16} />
              <span>{isLoggingOut ? "Keluar..." : "Keluar"}</span>
            </button>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      >
        {notice ? (
          <ActionNoticeBanner
            notice={notice}
            onDismiss={() => setNotice(null)}
          />
        ) : null}

        <section aria-labelledby="telemetry-heading">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h1
              id="telemetry-heading"
              className="text-lg font-semibold tracking-tight text-[#F1F5F9] sm:text-xl"
            >
              Pipeline HealthCheck & Device Sync
            </h1>
            {sessionExpiresAt ? (
              <span className="font-mono text-xs text-[#94A3B8]">
                Sesi aktif hingga {formatJakartaDateTime(sessionExpiresAt)}
              </span>
            ) : null}
          </div>

          {healthError ? (
            <div
              role="alert"
              className="flex flex-col items-start justify-between gap-4 rounded-lg border border-[#F43F5E] bg-[#260E15] p-5 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-3 text-[#FB7185]">
                <AlertCircleIcon size={20} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">
                    Telemetry HealthCheck tidak dapat dimuat
                  </p>
                  <p className="mt-1 font-mono text-xs break-words">
                    {healthError.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => mutateHealth()}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-[#FB7185] bg-[#11151B] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:bg-[#1E2530]"
              >
                <RefreshIcon size={16} />
                <span>Coba Lagi</span>
              </button>
            </div>
          ) : healthLoading && !healthData ? (
            <div className="rounded-lg border border-[#242B35] bg-[#11151B] p-6">
              <div className="flex items-center gap-3 text-sm text-[#A8B3C2]">
                <ClockPendingIcon size={18} className="text-[#34D399]" />
                <span>
                  Memuat telemetry kesehatan Redis, Gemini 2.5 Flash, Telegram
                  Webhook, dan heartbeat perangkat Android...
                </span>
              </div>
            </div>
          ) : healthData ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <article className="flex flex-col justify-between rounded-lg border border-[#242B35] bg-[#11151B] p-5 lg:col-span-5">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SmartphoneIcon size={18} className="text-[#34D399]" />
                      <h2 className="text-sm font-semibold text-[#F1F5F9]">
                        MacroDroid Device Sync
                      </h2>
                    </div>
                    {healthData.device.heartbeat.lastSeenAt === null ? (
                      <span className="inline-flex items-center gap-1.5 rounded border border-[#64748B] bg-[#1E2530] px-2 py-0.5 font-mono text-xs font-medium text-[#CBD5E1]">
                        <ClockPendingIcon size={13} />
                        <span>BELUM ADA SINYAL</span>
                      </span>
                    ) : healthData.device.heartbeat.isOnline ? (
                      <span className="inline-flex items-center gap-1.5 rounded border border-[#10B981] bg-[#0C231C] px-2 py-0.5 font-mono text-xs font-medium text-[#34D399]">
                        <CheckCircleIcon size={13} />
                        <span>HP TERHUBUNG</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded border border-[#F59E0B] bg-[#241908] px-2 py-0.5 font-mono text-xs font-medium text-[#FBBF24]">
                        <AlertTriangleIcon size={13} />
                        <span>HP OFFLINE</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-5">
                    <p className="text-xs text-[#A8B3C2]">
                      Tingkat Keberhasilan UI Automation
                    </p>
                    <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums text-[#F1F5F9]">
                      {actionableLogs > 0
                        ? `${healthData.device.uiSuccessRate}%`
                        : "Belum ada data"}
                    </p>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#242B35] pt-4 text-xs">
                    <div>
                      <dt className="text-[#94A3B8]">Terakhir Aktif</dt>
                      <dd className="mt-0.5 font-mono text-sm text-[#F1F5F9]">
                        {healthData.device.heartbeat.lastSeenAt
                          ? `${formatJakartaTime(healthData.device.heartbeat.lastSeenAt)} (${formatRelativeAge(healthData.device.heartbeat.secondsSinceLastSeen)})`
                          : "Belum ada sinyal"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#94A3B8]">Event Terakhir</dt>
                      <dd className="mt-0.5 font-mono text-sm text-[#F1F5F9]">
                        {healthData.device.heartbeat.lastEvent ?? "Belum ada"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#94A3B8]">Perangkat</dt>
                      <dd className="mt-0.5 font-mono text-sm break-words text-[#CBD5E1]">
                        {healthData.device.heartbeat.deviceModel ??
                          "Tidak terlacak"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#94A3B8]">Baterai HP</dt>
                      <dd className="mt-0.5 font-mono text-sm tabular-nums text-[#CBD5E1]">
                        {typeof healthData.device.heartbeat.batteryLevel ===
                        "number"
                          ? `${healthData.device.heartbeat.batteryLevel}%`
                          : "Tidak terlacak"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[#242B35] pt-4 sm:grid-cols-4">
                  <div className="rounded border border-[#242B35] bg-[#171C24] px-2.5 py-2">
                    <p className="text-[11px] text-[#A8B3C2]">Tercatat</p>
                    <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-[#34D399]">
                      {statusCounts.RECORDED}
                    </p>
                  </div>
                  <div className="rounded border border-[#242B35] bg-[#171C24] px-2.5 py-2">
                    <p className="text-[11px] text-[#A8B3C2]">Menunggu</p>
                    <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-[#FBBF24]">
                      {statusCounts.SENT_TO_PHONE}
                    </p>
                  </div>
                  <div className="rounded border border-[#242B35] bg-[#171C24] px-2.5 py-2">
                    <p className="text-[11px] text-[#A8B3C2]">Diblokir</p>
                    <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-[#CBD5E1]">
                      {statusCounts.IGNORED_PROMO}
                    </p>
                  </div>
                  <div className="rounded border border-[#242B35] bg-[#171C24] px-2.5 py-2">
                    <p className="text-[11px] text-[#A8B3C2]">Gagal</p>
                    <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-[#FB7185]">
                      {statusCounts.FAILED}
                    </p>
                  </div>
                </div>
              </article>

              <div className="flex flex-col gap-4 lg:col-span-7">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <article className="rounded-lg border border-[#242B35] bg-[#11151B] p-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ServerNodeIcon size={17} className="text-[#A8B3C2]" />
                        <h2 className="text-sm font-semibold text-[#F1F5F9]">
                          Vercel Runtime & Redis
                        </h2>
                      </div>
                      <ComponentHealthBadge
                        status={
                          healthData.redis.status === "ERROR"
                            ? "ERROR"
                            : healthData.runtime.status
                        }
                      />
                    </div>

                    <dl className="mt-4 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2 border-b border-[#242B35] pb-2">
                        <dt className="text-[#A8B3C2]">Region Runtime</dt>
                        <dd className="font-mono text-[#F1F5F9]">
                          {healthData.runtime.region}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-[#242B35] pb-2">
                        <dt className="text-[#A8B3C2]">Rata-rata API</dt>
                        <dd className="font-mono tabular-nums text-[#F1F5F9]">
                          {healthData.runtime.avgApiLatencyMs} ms
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-[#242B35] pb-2">
                        <dt className="text-[#A8B3C2]">Upstash Redis PING</dt>
                        <dd className="font-mono tabular-nums text-[#F1F5F9]">
                          {healthData.redis.status === "ONLINE"
                            ? `${healthData.redis.latencyMs} ms`
                            : "ERROR"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-[#A8B3C2]">Total Log Tersimpan</dt>
                        <dd className="font-mono tabular-nums text-[#F1F5F9]">
                          {healthData.redis.totalLogs} item
                        </dd>
                      </div>
                    </dl>

                    {healthData.redis.errorMessage ? (
                      <p className="mt-3 rounded border border-[#F43F5E] bg-[#260E15] px-2.5 py-1.5 font-mono text-xs break-words text-[#FB7185]">
                        {healthData.redis.errorMessage}
                      </p>
                    ) : null}
                  </article>

                  <article className="rounded-lg border border-[#242B35] bg-[#11151B] p-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ProcessorIcon size={17} className="text-[#A8B3C2]" />
                        <h2 className="text-sm font-semibold text-[#F1F5F9]">
                          Gemini 2.5 Flash Engine
                        </h2>
                      </div>
                      <ComponentHealthBadge status={healthData.gemini.status} />
                    </div>

                    <dl className="mt-4 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2 border-b border-[#242B35] pb-2">
                        <dt className="text-[#A8B3C2]">Model Aktif</dt>
                        <dd className="font-mono text-[#F1F5F9]">
                          {healthData.gemini.model}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-[#242B35] pb-2">
                        <dt className="text-[#A8B3C2]">Rata-rata Ekstraksi</dt>
                        <dd className="font-mono tabular-nums text-[#F1F5F9]">
                          {totalAllLogs > 0
                            ? `${healthData.gemini.avgLatencyMs} ms`
                            : "Belum ada data"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-[#242B35] pb-2">
                        <dt className="text-[#A8B3C2]">Rasio Filter Promo</dt>
                        <dd className="font-mono tabular-nums text-[#F1F5F9]">
                          {totalAllLogs > 0
                            ? `${healthData.gemini.promoFilterRate}%`
                            : "0%"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-[#A8B3C2]">Schema Output</dt>
                        <dd className="font-mono text-[#CBD5E1]">
                          Strict Enum JSON
                        </dd>
                      </div>
                    </dl>

                    {healthData.gemini.errorMessage ? (
                      <p className="mt-3 rounded border border-[#F43F5E] bg-[#260E15] px-2.5 py-1.5 font-mono text-xs break-words text-[#FB7185]">
                        {healthData.gemini.errorMessage}
                      </p>
                    ) : null}
                  </article>
                </div>

                <article className="rounded-lg border border-[#242B35] bg-[#11151B] p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <WebhookIcon
                        size={18}
                        className="mt-0.5 shrink-0 text-[#A8B3C2]"
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-[#F1F5F9]">
                            Telegram Bot Webhook
                          </h2>
                          <ComponentHealthBadge
                            status={healthData.telegram.status}
                          />
                        </div>
                        <p className="mt-1 font-mono text-xs text-[#A8B3C2]">
                          {healthData.telegram.botUsername
                            ? `@${healthData.telegram.botUsername}`
                            : "Bot username belum terdeteksi"}
                        </p>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-4 sm:flex sm:items-center sm:gap-6">
                      <div>
                        <dt className="text-xs text-[#94A3B8]">
                          Status Webhook
                        </dt>
                        <dd className="mt-0.5 font-mono text-sm text-[#F1F5F9]">
                          {healthData.telegram.webhookActive
                            ? "Aktif"
                            : "Tidak Aktif"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#94A3B8]">
                          Antrean Update
                        </dt>
                        <dd className="mt-0.5 font-mono text-sm tabular-nums text-[#F1F5F9]">
                          {healthData.telegram.pendingUpdateCount} pending
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {healthData.telegram.errorMessage ? (
                    <p className="mt-3 rounded border border-[#F43F5E] bg-[#260E15] px-3 py-2 font-mono text-xs break-words text-[#FB7185]">
                      {healthData.telegram.errorMessage}
                    </p>
                  ) : null}
                </article>
              </div>
            </div>
          ) : null}
        </section>

        <section
          aria-labelledby="logs-heading"
          className="rounded-lg border border-[#242B35] bg-[#11151B]"
        >
          <div className="flex flex-col gap-4 border-b border-[#242B35] p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <ListTelemetryIcon size={18} className="text-[#34D399]" />
                <h2
                  id="logs-heading"
                  className="text-base font-semibold text-[#F1F5F9] sm:text-lg"
                >
                  Live Transaction Logs
                </h2>
              </div>
              <p className="font-mono text-xs text-[#94A3B8]">
                {logs.length} log ditampilkan | Polling otomatis tiap 10 dtk
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Filter status log transaksi"
              className="flex flex-wrap gap-2"
            >
              {FILTER_TABS.map((tab) => {
                const isSelected = activeTab === tab.id;
                const tabCount =
                  tab.id === "ALL" ? totalAllLogs : statusCounts[tab.id];
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-medium transition-colors sm:text-sm ${
                      isSelected
                        ? "border-[#34D399] bg-[#0C231C] text-[#34D399]"
                        : "border-[#64748B] bg-[#171C24] text-[#CBD5E1] hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="rounded bg-[#090B0E] px-1.5 py-0.5 font-mono text-xs tabular-nums text-[#CBD5E1]">
                      {tabCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5">
            {logsError ? (
              <div
                role="alert"
                className="flex flex-col items-start justify-between gap-4 rounded-md border border-[#F43F5E] bg-[#260E15] p-4 sm:flex-row sm:items-center"
              >
                <div className="flex items-start gap-2.5 text-[#FB7185]">
                  <AlertCircleIcon size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">
                      Gagal memuat riwayat log transaksi
                    </p>
                    <p className="mt-1 font-mono text-xs break-words">
                      {logsError.message}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => mutateLogs()}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-[#FB7185] bg-[#11151B] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:bg-[#1E2530]"
                >
                  <RefreshIcon size={16} />
                  <span>Muat Ulang Log</span>
                </button>
              </div>
            ) : logsLoading && !logsData ? (
              <div className="rounded-md border border-[#242B35] bg-[#171C24] p-6">
                <div className="flex items-center gap-3 text-sm text-[#A8B3C2]">
                  <ClockPendingIcon size={18} className="text-[#34D399]" />
                  <span>
                    Memuat riwayat log transaksi dari Upstash Redis...
                  </span>
                </div>
              </div>
            ) : logs.length === 0 && activeTab !== "ALL" ? (
              <div className="rounded-md border border-[#242B35] bg-[#171C24] p-6">
                <p className="text-sm font-medium text-[#F1F5F9]">
                  Tidak ada log pada filter{" "}
                  {FILTER_TABS.find((t) => t.id === activeTab)?.label}.
                </p>
                <p className="mt-1.5 text-sm text-[#A8B3C2]">
                  Terdapat {totalAllLogs} total log di kategori lain pada Upstash
                  Redis.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("ALL")}
                  className="mt-4 inline-flex min-h-[44px] items-center rounded-md border border-[#64748B] bg-[#11151B] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530]"
                >
                  Tampilkan Semua Log
                </button>
              </div>
            ) : logs.length === 0 ? (
              <div className="rounded-md border border-[#242B35] bg-[#171C24] p-6">
                <p className="text-sm font-medium text-[#F1F5F9]">
                  Belum ada log transaksi tersimpan di Upstash Redis.
                </p>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#A8B3C2]">
                  Log akan muncul otomatis saat MacroDroid meneruskan notifikasi
                  bank/e-wallet atau saat Anda mengirim catatan transaksi atau
                  foto struk ke bot Telegram.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handlePingDevice}
                    disabled={isPinging}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-[#04120C] transition-colors hover:bg-[#34D399]"
                  >
                    <SignalWaveIcon size={16} />
                    <span>
                      {isPinging ? "Mengirim Ping..." : "Test Ping ke HP"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshAll}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#64748B] bg-[#11151B] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530]"
                  >
                    <RefreshIcon size={16} />
                    <span>Periksa Lagi</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="hidden lg:block">
                  <table className="w-full table-fixed border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#242B35] text-xs font-medium text-[#94A3B8]">
                        <th className="w-[84px] py-3 pr-3">Waktu (WIB)</th>
                        <th className="w-[124px] py-3 pr-3">Sumber</th>
                        <th className="py-3 pr-3">Cuplikan Input & Catatan</th>
                        <th className="w-[176px] py-3 pr-3">Pemetaan AI</th>
                        <th className="w-[128px] py-3 pr-3 text-right">
                          Nominal (IDR)
                        </th>
                        <th className="w-[124px] py-3 pr-3">Status HP</th>
                        <th className="w-[156px] py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#242B35] text-sm">
                      {logs.map((item) => {
                        const isItemRetrying = retryingId === item.id;
                        return (
                          <tr
                            key={item.id}
                            className="align-top transition-colors hover:bg-[#171C24]"
                          >
                            <td className="py-3.5 pr-3 font-mono text-xs">
                              <span className="block text-[#F1F5F9]">
                                {formatJakartaTime(item.timestamp)}
                              </span>
                              <span className="mt-0.5 block text-[#94A3B8]">
                                {formatJakartaShortDate(item.timestamp)}
                              </span>
                            </td>
                            <td className="py-3.5 pr-3">
                              <SourceBadge
                                source={item.source}
                                appName={item.appName}
                              />
                              <span className="mt-1 block font-mono text-xs tabular-nums text-[#94A3B8]">
                                {item.latencyMs} ms
                              </span>
                            </td>
                            <td className="min-w-0 py-3.5 pr-3">
                              <p className="truncate font-mono text-xs text-[#CBD5E1]">
                                {item.rawInput}
                              </p>
                              {item.parsedData?.note ? (
                                <p className="mt-1 truncate text-xs text-[#A8B3C2]">
                                  Note: {item.parsedData.note}
                                </p>
                              ) : item.errorMessage ? (
                                <p className="mt-1 truncate font-mono text-xs text-[#FB7185]">
                                  {item.errorMessage}
                                </p>
                              ) : null}
                            </td>
                            <td className="min-w-0 py-3.5 pr-3">
                              {item.parsedData ? (
                                <div>
                                  <span className="inline-block max-w-full truncate rounded border border-[#64748B] bg-[#171C24] px-2 py-0.5 text-xs font-medium text-[#F1F5F9]">
                                    {item.parsedData.account}
                                  </span>
                                  <p className="mt-1 truncate text-xs text-[#CBD5E1]">
                                    {formatCategoryPath(item.parsedData)}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-xs text-[#94A3B8]">
                                  {item.status === "IGNORED_PROMO"
                                    ? "Diabaikan filter AI"
                                    : "Belum terpetakan"}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 pr-3 text-right font-mono text-xs tabular-nums">
                              {item.parsedData ? (
                                <span
                                  className={`inline-flex items-center justify-end gap-1 font-semibold ${
                                    item.parsedData.type === "Income"
                                      ? "text-[#34D399]"
                                      : "text-[#FB7185]"
                                  }`}
                                >
                                  {item.parsedData.type === "Income" ? (
                                    <ArrowDownLeftIcon size={14} />
                                  ) : (
                                    <ArrowUpRightIcon size={14} />
                                  )}
                                  <span>
                                    {item.parsedData.type === "Income"
                                      ? "+"
                                      : "-"}
                                    {formatIdr(item.parsedData.amount)}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[#94A3B8]">N/A</span>
                              )}
                            </td>
                            <td className="py-3.5 pr-3">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="py-3.5 text-right">
                              <div className="inline-flex items-center justify-end gap-2">
                                {item.parsedData ? (
                                  <button
                                    type="button"
                                    onClick={() => handleRetryLog(item.id)}
                                    disabled={isItemRetrying}
                                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[#64748B] bg-[#171C24] px-2.5 py-1.5 text-xs font-medium text-[#F1F5F9] transition-colors hover:border-[#34D399] hover:bg-[#1E2530] disabled:cursor-not-allowed disabled:text-[#94A3B8]"
                                  >
                                    <RefreshIcon size={14} />
                                    <span>
                                      {isItemRetrying ? "Kirim..." : "Retry"}
                                    </span>
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={(event) =>
                                    openDetailModal(item, event.currentTarget)
                                  }
                                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[#64748B] bg-[#171C24] px-2.5 py-1.5 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9]"
                                >
                                  <InspectCodeIcon size={14} />
                                  <span>Detail</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
                  {logs.map((item) => {
                    const isItemRetrying = retryingId === item.id;
                    return (
                      <article
                        key={item.id}
                        className="flex min-w-0 flex-col justify-between rounded-md border border-[#242B35] bg-[#171C24] p-4"
                      >
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <StatusBadge status={item.status} />
                            <span className="font-mono text-xs text-[#94A3B8]">
                              {formatJakartaShortDate(item.timestamp)}{" "}
                              {formatJakartaTime(item.timestamp)} WIB
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                            <SourceBadge
                              source={item.source}
                              appName={item.appName}
                            />
                            {item.parsedData ? (
                              <span
                                className={`inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums ${
                                  item.parsedData.type === "Income"
                                    ? "text-[#34D399]"
                                    : "text-[#FB7185]"
                                }`}
                              >
                                {item.parsedData.type === "Income" ? (
                                  <ArrowDownLeftIcon size={14} />
                                ) : (
                                  <ArrowUpRightIcon size={14} />
                                )}
                                <span>
                                  {item.parsedData.type === "Income" ? "+" : "-"}
                                  {formatIdr(item.parsedData.amount)}
                                </span>
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-[#94A3B8]">
                                {item.latencyMs} ms
                              </span>
                            )}
                          </div>

                          {item.parsedData ? (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded border border-[#64748B] bg-[#11151B] px-2 py-0.5 font-medium text-[#F1F5F9]">
                                {item.parsedData.account}
                              </span>
                              <span className="text-[#CBD5E1]">
                                {formatCategoryPath(item.parsedData)}
                              </span>
                              {item.parsedData.note ? (
                                <span className="text-[#A8B3C2]">
                                  ({item.parsedData.note})
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          <p className="mt-2.5 rounded border border-[#242B35] bg-[#090B0E] p-2.5 font-mono text-xs leading-relaxed break-words text-[#CBD5E1]">
                            {item.rawInput}
                          </p>

                          {item.errorMessage ? (
                            <p className="mt-2 font-mono text-xs break-words text-[#FB7185]">
                              {item.errorMessage}
                            </p>
                          ) : null}
                        </div>

                        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                          {item.parsedData ? (
                            <button
                              type="button"
                              onClick={() => handleRetryLog(item.id)}
                              disabled={isItemRetrying}
                              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md border border-[#64748B] bg-[#11151B] px-3 py-2 text-xs font-medium text-[#F1F5F9] transition-colors hover:border-[#34D399] hover:bg-[#1E2530] disabled:cursor-not-allowed disabled:text-[#94A3B8]"
                            >
                              <RefreshIcon size={14} />
                              <span>
                                {isItemRetrying ? "Mengirim..." : "Retry"}
                              </span>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={(event) =>
                              openDetailModal(item, event.currentTarget)
                            }
                            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md border border-[#64748B] bg-[#11151B] px-3 py-2 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9]"
                          >
                            <InspectCodeIcon size={14} />
                            <span>Detail</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      </main>

      {selectedLog ? (
        <LogDetailModal
          log={selectedLog}
          isRetrying={retryingId === selectedLog.id}
          onClose={closeDetailModal}
          onRetry={handleRetryLog}
        />
      ) : null}
    </div>
  );
}
