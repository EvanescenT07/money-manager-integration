import { ApiError, GoogleGenAI, type ContentListUnion } from "@google/genai";
import { z } from "zod";
import {
  ActiveAccountEnum,
  AllCategoryEnum,
  GeminiResponseSchema,
  SubcategoryEnum,
  TransactionTypeEnum,
  sanitizeHierarchy,
} from "@/types/enums";
import type { GeminiHealthMetrics, ParsedTransactionData } from "@/types/logs";
import { ConfigError, ExternalServiceError } from "./errors";
import { logger } from "./logger";

export const GEMINI_MODEL = "gemini-2.5-flash";

const GEMINI_REQUEST_TIMEOUT_MS = 25_000;
const GEMINI_HEALTH_TIMEOUT_MS = 8_000;
const GEMINI_HEALTH_CACHE_TTL_MS = 60_000;

const SYSTEM_PROMPT = `You are a precision Indonesian personal finance parser for Realbyte Money Manager.
Extract financial transactions from bank/e-wallet notifications, free-form chat text, or receipt/transfer images and return strict JSON matching the schema.

Ignore Rules:
- Set ignore=true and transactions=[] when the input is a promo, advertisement, voucher offer, OTP, login alert, security code, greeting, or contains no real money movement or clear amount.
- When ignore=false, extract one item per distinct transaction into transactions[].

Strict Spelling and Hierarchy Rules (case-sensitive and typo-preserved):
- Allowed active accounts ONLY:
  "Jago", "Cash", "Shopeepay", "Gopay", "Blu", "Mandiri", "BCA", "Rdn Stockbit", "Jago - Paylater", "Other"
- Allowed Expense categories and their exact allowed subcategories:
  - "Food": "Daily", "Jajan", "Coffee", "Nongkrong", "Date FnB", ""
  - "Transportation": "Transport Umum", "Bensin", "Bengkel", "Parkir", "Automotive Part", ""
  - "Social Life": "Friend", "Hangout", "Alumni", ""
  - "Self Need": "Internet", "Self Need", "Fragrance", "Electronic", "Skin Care", ""
  - "Other": "Mama", "Rumah", "Feesible", ""
  - "Self-development": "Investment", "Book", "" (lowercase "d" in Self-development)
  - "Apparel": "Laundry", "Shoes", "Clothing", ""
  - "Paylater": ""
  - "Entertaiment": "Top Up", "Movie", "Warnet", "Billiard", "TimeZone", "Apps", "Music", "" (spelled "Entertaiment" without middle "n")
  - "Beauty": ""
  - "Health": "Medicine", "Health", ""
  - "Work Need": "Outing", ""
  - "Education": ""
  - "Shopping": "Shopee", "e-Commerce", "" (exact casing "e-Commerce")
  - "Gift": ""
- Allowed Income categories and their exact allowed subcategories:
  - "Other": "Cashback", "Other", ""
  - "Investment": "Stockbit", ""
  - "Social": ""
  - "Allowance": "SMBC", "AMFS", "BSI", "Monthly Allowance", ""
  - "THR": ""
  - "Salary": ""
  - "Part Time": ""
  - "Bonus": ""
  - "Petty cash": "" (lowercase "c" in Petty cash)

Bank and E-Wallet Mapping Rules:
1. Bank Jago (com.jago.digitalBanking): default account "Jago".
   - QRIS payment or outgoing transfer -> Expense.
   - Incoming transfer from friend -> Income, category "Social", subcategory "".
   - Pocket interest (bunga kantong) -> Income, category "Other", subcategory "Other".
2. blu by BCA Digital (id.co.bcadigital.blu): default account "Blu".
   - QRIS or debit transaction -> Expense.
   - Cashback blu -> Income, category "Other", subcategory "Cashback".
3. Shopee / ShopeePay (com.shopee.id): default account "Shopeepay".
   - Merchant or QRIS payment -> Expense.
   - Coin or balance cashback -> Income, category "Other", subcategory "Cashback".
   - SPayLater bill / tagihan SPayLater -> account "Jago - Paylater", category "Paylater", subcategory "".
4. Gojek / GoPay (com.gojek.app or com.gojek.gopay): default account "Gopay".
   - GoRide / GoCar / GoPay QRIS -> Expense.
   - Incoming GoPay transfer from friend -> Income, category "Social", subcategory "".
5. Livin' by Mandiri (id.bmri.livin): default account "Mandiri".
   - Payroll / salary / gaji -> Income, category "Salary", subcategory "".
   - Allowance AMFS -> Income, category "Allowance", subcategory "AMFS".
   - QRIS or outgoing transfer -> Expense.
6. BCA mobile / myBCA (com.bca or com.bca.mybca.omni.android): default account "BCA".
   - Outgoing mutation -> Expense.
   - Incoming mutation -> Income.
7. Stockbit (com.stockbit.android): default account "Rdn Stockbit".
   - Cash dividend or RDN withdrawal -> Income, category "Investment", subcategory "Stockbit".
   - Stock buy or IPO -> Expense, category "Self-development", subcategory "Investment".
8. Cashback from any provider -> Income, category "Other", subcategory "Cashback".

Formatting Rules:
- amount: positive rounded integer in IDR without separators or decimals (e.g. Rp 28.500 -> 28500).
- note: concise lowercase description matching user history style (e.g. "kopi kenangan", "transjakarta", "dari yudhis", "spaylater").
- description: optional extra detail such as reference or items, or "" if none.`;

const GeminiRawTransactionSchema = z.object({
  type: TransactionTypeEnum,
  account: ActiveAccountEnum,
  category: AllCategoryEnum,
  subcategory: SubcategoryEnum,
  amount: z.number().finite(),
  note: z.string(),
  description: z.string().optional().default(""),
});

const GeminiParsedResponseSchema = z.object({
  ignore: z.boolean(),
  reason: z.string().optional().default(""),
  transactions: z.array(GeminiRawTransactionSchema).default([]),
});

export interface GeminiExtractedTransaction extends ParsedTransactionData {
  hierarchyAdjusted: boolean;
}

export interface GeminiExtractionResult {
  ignore: boolean;
  reason: string;
  transactions: GeminiExtractedTransaction[];
  latencyMs: number;
}

export interface TextExtractionInput {
  text: string;
  title?: string;
  appName?: string;
  appPackage?: string;
}

export interface ImageExtractionInput {
  base64Data: string;
  mimeType: string;
  caption?: string;
}

interface CachedHealthEntry {
  apiKey: string;
  expiresAt: number;
  metrics: GeminiHealthMetrics;
}

let healthCache: CachedHealthEntry | null = null;

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError("GEMINI_API_KEY environment variable is missing");
  }
  return apiKey;
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

function isNarrowGeminiError(error: unknown): boolean {
  if (
    error instanceof ApiError ||
    error instanceof SyntaxError ||
    error instanceof z.ZodError ||
    error instanceof TypeError ||
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

function buildTextPrompt(input: string | TextExtractionInput): string {
  if (typeof input === "string") {
    return `Analyze this transaction text:\n${input}`;
  }

  const lines: string[] = [];
  if (input.appName) {
    lines.push(`App Name: ${input.appName}`);
  }
  if (input.appPackage) {
    lines.push(`Android Package: ${input.appPackage}`);
  }
  if (input.title) {
    lines.push(`Notification Title: ${input.title}`);
  }
  lines.push(`Text: ${input.text}`);
  return lines.join("\n");
}

async function runExtraction(
  contents: ContentListUnion,
  mode: "text" | "image"
): Promise<GeminiExtractionResult> {
  const apiKey = getGeminiApiKey();
  const ai = createGeminiClient(apiKey);
  const startedAt = performance.now();

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: GeminiResponseSchema,
        temperature: 0.1,
        abortSignal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
      },
    });

    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const rawText = response.text?.trim();
    if (!rawText) {
      throw new ExternalServiceError(
        "GEMINI",
        "Gemini returned an empty response body"
      );
    }

    const rawJson: unknown = JSON.parse(rawText);
    const parsed = GeminiParsedResponseSchema.parse(rawJson);

    if (parsed.ignore || parsed.transactions.length === 0) {
      return {
        ignore: true,
        reason:
          parsed.reason.trim() || "Non-transaction, promo, or OTP message",
        transactions: [],
        latencyMs,
      };
    }

    const normalizedTransactions: GeminiExtractedTransaction[] =
      parsed.transactions.map((tx) => {
        const roundedAmount = Math.round(tx.amount);
        if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
          throw new ExternalServiceError(
            "GEMINI",
            `Gemini returned invalid non-positive amount: ${String(tx.amount)}`
          );
        }

        const sanitized = sanitizeHierarchy(
          tx.type,
          tx.category,
          tx.subcategory
        );

        return {
          type: tx.type,
          account: tx.account,
          category: sanitized.category,
          subcategory: sanitized.subcategory,
          amount: roundedAmount,
          currency: "IDR",
          note: tx.note.trim().toLowerCase() || "transaksi",
          description: tx.description.trim(),
          hierarchyAdjusted: sanitized.wasAdjusted,
        };
      });

    return {
      ignore: false,
      reason: parsed.reason.trim(),
      transactions: normalizedTransactions,
      latencyMs,
    };
  } catch (err) {
    if (err instanceof ExternalServiceError || err instanceof ConfigError) {
      throw err;
    }
    if (isNarrowGeminiError(err)) {
      logger.error("gemini.extraction_failed", err, { mode });
      const message =
        err instanceof Error ? err.message : "Gemini extraction failed";
      throw new ExternalServiceError("GEMINI", message, err);
    }
    throw err;
  }
}

export async function extractTransactionsFromText(
  input: string | TextExtractionInput
): Promise<GeminiExtractionResult> {
  const prompt = buildTextPrompt(input);
  return runExtraction(prompt, "text");
}

export async function extractTransactionsFromImage(
  input: ImageExtractionInput
): Promise<GeminiExtractionResult> {
  if (!input.base64Data) {
    throw new ExternalServiceError(
      "GEMINI",
      "Image base64 payload cannot be empty"
    );
  }

  const instructionText = input.caption?.trim()
    ? `Extract financial transactions from this receipt or transfer proof. User caption: ${input.caption.trim()}`
    : "Extract financial transactions from this receipt or transfer proof image.";

  const contents: ContentListUnion = [
    {
      role: "user",
      parts: [
        { text: instructionText },
        {
          inlineData: {
            data: input.base64Data,
            mimeType: input.mimeType,
          },
        },
      ],
    },
  ];

  return runExtraction(contents, "image");
}

export async function checkGeminiHealth(): Promise<GeminiHealthMetrics> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "ERROR",
      model: GEMINI_MODEL,
      avgLatencyMs: 0,
      promoFilterRate: 0,
      errorMessage: "GEMINI_API_KEY is not configured",
    };
  }

  const now = Date.now();
  if (
    healthCache &&
    healthCache.apiKey === apiKey &&
    healthCache.expiresAt > now
  ) {
    return healthCache.metrics;
  }

  const startedAt = performance.now();
  try {
    const ai = createGeminiClient(apiKey);
    await ai.models.get({
      model: GEMINI_MODEL,
      config: {
        abortSignal: AbortSignal.timeout(GEMINI_HEALTH_TIMEOUT_MS),
      },
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const metrics: GeminiHealthMetrics = {
      status: "ONLINE",
      model: GEMINI_MODEL,
      avgLatencyMs: latencyMs,
      promoFilterRate: 0,
    };
    healthCache = {
      apiKey,
      expiresAt: now + GEMINI_HEALTH_CACHE_TTL_MS,
      metrics,
    };
    return metrics;
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (isNarrowGeminiError(err)) {
      logger.error("gemini.health_check_failed", err, { latencyMs });
      const isQuotaLimit = err instanceof ApiError && err.status === 429;
      const metrics: GeminiHealthMetrics = {
        status: isQuotaLimit ? "DEGRADED" : "ERROR",
        model: GEMINI_MODEL,
        avgLatencyMs: latencyMs,
        promoFilterRate: 0,
        errorMessage:
          err instanceof Error ? err.message : "Gemini health check failed",
      };
      if (isQuotaLimit) {
        healthCache = {
          apiKey,
          expiresAt: now + GEMINI_HEALTH_CACHE_TTL_MS,
          metrics,
        };
      }
      return metrics;
    }
    throw err;
  }
}
