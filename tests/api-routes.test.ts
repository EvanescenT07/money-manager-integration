import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";
import { GET, POST } from "../src/app/api/[[...route]]/route";
import type { TransactionLogItem } from "../src/types/logs";

const ENV_KEYS = [
  "DASHBOARD_PASSCODE",
  "SESSION_SECRET",
  "MACRODROID_SECRET",
  "MACRODROID_WEBHOOK_URL",
  "TELEGRAM_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "ALLOWED_CHAT_ID",
  "GEMINI_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

interface MockRedisState {
  strings: Map<string, string>;
  lists: Map<string, string[]>;
  hashes: Map<string, Map<string, string>>;
}

interface FetchCallRecord {
  url: string;
  method: string;
  bodyText: string;
}

function createMockRedisCommandRunner(state: MockRedisState) {
  return (cmdArgs: unknown[]): unknown => {
    const command = String(cmdArgs[0] ?? "").toUpperCase();
    const args = cmdArgs.slice(1).map((item) => String(item));

    switch (command) {
      case "PING":
        return "PONG";
      case "GET":
        return state.strings.get(args[0]) ?? null;
      case "MGET":
        return args.map((key) => state.strings.get(key) ?? null);
      case "SET": {
        const key = args[0];
        const value = args[1] ?? "";
        const upperFlags = args.slice(2).map((flag) => flag.toUpperCase());
        if (upperFlags.includes("NX") && state.strings.has(key)) {
          return null;
        }
        state.strings.set(key, value);
        return "OK";
      }
      case "DEL": {
        let removed = 0;
        for (const key of args) {
          if (state.strings.delete(key)) removed += 1;
          if (state.lists.delete(key)) removed += 1;
          if (state.hashes.delete(key)) removed += 1;
        }
        return removed;
      }
      case "LPUSH": {
        const key = args[0];
        const list = state.lists.get(key) ?? [];
        for (const value of args.slice(1)) {
          list.unshift(value);
        }
        state.lists.set(key, list);
        return list.length;
      }
      case "LTRIM": {
        const key = args[0];
        const start = Number(args[1] ?? 0);
        const stop = Number(args[2] ?? -1);
        const list = state.lists.get(key) ?? [];
        const end = stop < 0 ? list.length + stop + 1 : stop + 1;
        state.lists.set(key, list.slice(Math.max(0, start), Math.max(0, end)));
        return "OK";
      }
      case "LRANGE": {
        const key = args[0];
        const start = Number(args[1] ?? 0);
        const stop = Number(args[2] ?? -1);
        const list = state.lists.get(key) ?? [];
        const end = stop < 0 ? list.length + stop + 1 : stop + 1;
        return list.slice(Math.max(0, start), Math.max(0, end));
      }
      case "LLEN":
        return (state.lists.get(args[0]) ?? []).length;
      case "HSET": {
        const key = args[0];
        const hash = state.hashes.get(key) ?? new Map<string, string>();
        let added = 0;
        for (let i = 1; i + 1 < args.length; i += 2) {
          if (!hash.has(args[i])) added += 1;
          hash.set(args[i], args[i + 1]);
        }
        state.hashes.set(key, hash);
        return added;
      }
      case "HGETALL": {
        const hash = state.hashes.get(args[0]);
        if (!hash) return [];
        const flat: string[] = [];
        for (const [k, v] of hash.entries()) {
          flat.push(k, v);
        }
        return flat;
      }
      default:
        return null;
    }
  };
}

function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/mm_session=([^;]+)/);
  return match ? `mm_session=${match[1]}` : "";
}

async function loginAndGetCookie(): Promise<string> {
  const loginRes = await POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "998877" }),
    })
  );
  return extractSessionCookie(loginRes);
}

describe("API Routes (Hono)", () => {
  const originalEnv: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;
  let redisState: MockRedisState;
  let fetchCalls: FetchCallRecord[];
  let geminiNextResponse: unknown;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }

    process.env.DASHBOARD_PASSCODE = "998877";
    process.env.SESSION_SECRET = "test-session-hmac-secret";
    process.env.MACRODROID_SECRET = "test-macrodroid-secret";
    process.env.MACRODROID_WEBHOOK_URL = "https://macrodroid.mock.local/input_mm";
    process.env.TELEGRAM_TOKEN = "123456:test-telegram-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-telegram-secret";
    process.env.ALLOWED_CHAT_ID = "777888999";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.mock.local";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-redis-token";

    redisState = {
      strings: new Map<string, string>(),
      lists: new Map<string, string[]>(),
      hashes: new Map<string, Map<string, string>>(),
    };
    fetchCalls = [];

    geminiNextResponse = {
      ignore: false,
      reason: "Extracted coffee transaction",
      transactions: [
        {
          type: "Expense",
          account: "Jago",
          category: "Food",
          subcategory: "Coffee",
          amount: 25000,
          note: "kopi kenangan",
          description: "qris",
        },
      ],
    };

    const runRedisCmd = createMockRedisCommandRunner(redisState);

    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const bodyText =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";

      fetchCalls.push({ url, method, bodyText });

      if (url.startsWith("https://redis.mock.local")) {
        const parsed = bodyText ? (JSON.parse(bodyText) as unknown) : [];
        if (url.endsWith("/pipeline") || url.endsWith("/multi-exec")) {
          const commands = Array.isArray(parsed) ? (parsed as unknown[][]) : [];
          const results = commands.map((cmd) => ({ result: runRedisCmd(cmd) }));
          return new Response(JSON.stringify(results), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const singleCmd = Array.isArray(parsed)
          ? (parsed as unknown[])
          : ["PING"];
        return new Response(JSON.stringify({ result: runRedisCmd(singleCmd) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://macrodroid.mock.local")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/file/bot")) {
          return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        if (url.includes("/getFile")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                file_id: "photo-file-1",
                file_path: "photos/receipt.jpg",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/getWebhookInfo")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                url: "https://app.mock.local/api/webhook/telegram",
                pending_update_count: 0,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/getMe")) {
          return new Response(
            JSON.stringify({ ok: true, result: { username: "mm_autosync_bot" } }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 101 } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("generativelanguage.googleapis.com")) {
        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(geminiNextResponse) }],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ name: "models/gemini-2.5-flash" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("handles auth login, session check, tamper rejection, and logout", async () => {
    const initialSessionRes = await GET(
      new Request("http://localhost/api/auth/session")
    );
    expect(initialSessionRes.status).toBe(200);
    expect(await initialSessionRes.json()).toEqual({ authenticated: false });

    const badPayloadRes = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "" }),
      })
    );
    expect(badPayloadRes.status).toBe(400);

    const wrongPasscodeRes = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "000000" }),
      })
    );
    expect(wrongPasscodeRes.status).toBe(401);
    expect(wrongPasscodeRes.headers.get("set-cookie")).toBeNull();

    const validLoginRes = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "998877" }),
      })
    );
    expect(validLoginRes.status).toBe(200);
    const loginBody = (await validLoginRes.json()) as {
      authenticated: boolean;
      expiresAt?: string;
    };
    expect(loginBody.authenticated).toBe(true);
    expect(typeof loginBody.expiresAt).toBe("string");

    const setCookieHeader = validLoginRes.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain("mm_session=");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Lax");

    const sessionCookie = extractSessionCookie(validLoginRes);
    expect(sessionCookie.length).toBeGreaterThan(15);

    const activeSessionRes = await GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: sessionCookie },
      })
    );
    expect(activeSessionRes.status).toBe(200);
    const activeBody = (await activeSessionRes.json()) as {
      authenticated: boolean;
      expiresAt?: string;
    };
    expect(activeBody.authenticated).toBe(true);

    const tamperedSessionRes = await GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: `${sessionCookie}tampered` },
      })
    );
    expect(tamperedSessionRes.status).toBe(200);
    expect(await tamperedSessionRes.json()).toEqual({ authenticated: false });

    const logoutRes = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: sessionCookie },
      })
    );
    expect(logoutRes.status).toBe(200);
    const logoutCookie = logoutRes.headers.get("set-cookie") ?? "";
    expect(logoutCookie).toContain("mm_session=");
    expect(logoutCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("fails closed when DASHBOARD_PASSCODE is unconfigured", async () => {
    delete process.env.DASHBOARD_PASSCODE;
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "998877" }),
      })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain("test-session-hmac-secret");
  });

  it("rejects unauthenticated requests to all protected routes with 401", async () => {
    const protectedRequests = [
      GET(new Request("http://localhost/api/health")),
      GET(new Request("http://localhost/api/logs")),
      GET(new Request("http://localhost/api/logs/export")),
      POST(
        new Request("http://localhost/api/logs/log-1/retry", {
          method: "POST",
        })
      ),
      POST(new Request("http://localhost/api/device/ping", { method: "POST" })),
    ];

    const responses = await Promise.all(protectedRequests);
    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it("enforces MacroDroid webhook secret, validation, deduplication, and ack lifecycle", async () => {
    const missingSecretRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_package: "com.jago.digitalBanking",
          app_name: "Jago",
          title: "QRIS Berhasil",
          text: "Bayar Rp25.000 ke Kopi Kenangan",
        }),
      })
    );
    expect(missingSecretRes.status).toBe(401);

    const wrongSecretRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "invalid-secret",
        },
        body: JSON.stringify({ title: "QRIS", text: "Rp25.000" }),
      })
    );
    expect(wrongSecretRes.status).toBe(401);

    delete process.env.MACRODROID_SECRET;
    const unsetSecretRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({ title: "QRIS", text: "Rp25.000" }),
      })
    );
    expect(unsetSecretRes.status).toBe(401);
    process.env.MACRODROID_SECRET = "test-macrodroid-secret";

    const invalidPayloadRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          app_package: "com.jago.digitalBanking",
          app_name: "Jago",
          title: "   ",
          text: "",
        }),
      })
    );
    expect(invalidPayloadRes.status).toBe(400);

    const payloadBody = JSON.stringify({
      app_package: "com.jago.digitalBanking",
      app_name: "Jago",
      title: "Transaksi QRIS Berhasil",
      text: "Pembayaran Rp25.000 ke Kopi Kenangan",
    });

    const validWebhookRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: payloadBody,
      })
    );
    expect(validWebhookRes.status).toBe(200);

    const duplicateWebhookRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: payloadBody,
      })
    );
    expect(duplicateWebhookRes.status).toBe(200);

    const logIds = redisState.lists.get("mm:logs:ids") ?? [];
    expect(logIds.length).toBe(1);
    const createdLogId = logIds[0];

    const invalidAckRes = await POST(
      new Request("http://localhost/api/webhook/ack", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({ log_id: "" }),
      })
    );
    expect(invalidAckRes.status).toBe(400);

    const validAckRes = await POST(
      new Request("http://localhost/api/webhook/ack", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          log_id: createdLogId,
          status: "RECORDED",
        }),
      })
    );
    expect(validAckRes.status).toBe(200);

    const cookie = await loginAndGetCookie();
    const logsRes = await GET(
      new Request("http://localhost/api/logs?status=RECORDED", {
        headers: { cookie },
      })
    );
    expect(logsRes.status).toBe(200);
    const logsJson = (await logsRes.json()) as {
      ok: boolean;
      logs: TransactionLogItem[];
    };
    expect(logsJson.logs.length).toBe(1);
    expect(logsJson.logs[0]?.id).toBe(createdLogId);
    expect(logsJson.logs[0]?.status).toBe("RECORDED");
  });

  it("records IGNORED_PROMO without dispatching to MacroDroid and splits multi-transaction items", async () => {
    geminiNextResponse = {
      ignore: true,
      reason: "OTP verification code",
      transactions: [],
    };

    const promoRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          app_package: "com.jago.digitalBanking",
          app_name: "Jago",
          title: "Kode OTP",
          text: "Jangan bagikan kode OTP 123456",
        }),
      })
    );
    expect(promoRes.status).toBe(200);
    expect(
      fetchCalls.filter((c) => c.url.startsWith("https://macrodroid.mock.local"))
        .length
    ).toBe(0);

    geminiNextResponse = {
      ignore: false,
      reason: "Split dinner and cashback",
      transactions: [
        {
          type: "Expense",
          account: "Blu",
          category: "Food",
          subcategory: "Daily",
          amount: 50000,
          note: "nasi goreng",
          description: "",
        },
        {
          type: "Income",
          account: "Blu",
          category: "Other",
          subcategory: "Cashback",
          amount: 5000,
          note: "cashback blu qris",
          description: "",
        },
      ],
    };

    const multiRes = await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          app_package: "id.co.bcadigital.blu",
          app_name: "blu",
          title: "Transaksi QRIS & Cashback",
          text: "Bayar Rp50.000, dapat cashback Rp5.000",
        }),
      })
    );
    expect(multiRes.status).toBe(200);
    expect(
      fetchCalls.filter((c) => c.url.startsWith("https://macrodroid.mock.local"))
        .length
    ).toBe(2);

    const cookie = await loginAndGetCookie();
    const logsRes = await GET(
      new Request("http://localhost/api/logs", { headers: { cookie } })
    );
    const logsJson = (await logsRes.json()) as {
      logs: TransactionLogItem[];
      statusCounts: Record<string, number>;
    };
    expect(logsJson.statusCounts.IGNORED_PROMO).toBe(1);
    expect(logsJson.statusCounts.SENT_TO_PHONE).toBe(2);
    const sentLogs = logsJson.logs.filter((l) => l.status === "SENT_TO_PHONE");
    expect(sentLogs).toHaveLength(2);
    expect(sentLogs[0]?.correlationGroupId).toBeDefined();
    expect(sentLogs[0]?.correlationGroupId).toBe(
      sentLogs[1]?.correlationGroupId
    );
  });

  it("enforces Telegram webhook secret, ALLOWED_CHAT_ID, OCR, and inline retry callbacks", async () => {
    const missingSecretRes = await POST(
      new Request("http://localhost/api/webhook/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ update_id: 1 }),
      })
    );
    expect(missingSecretRes.status).toBe(401);

    const unauthorizedMsgRes = await POST(
      new Request("http://localhost/api/webhook/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify({
          update_id: 1001,
          message: {
            message_id: 10,
            chat: { id: 111222333 },
            text: "beli kopi 25rb",
          },
        }),
      })
    );
    expect(unauthorizedMsgRes.status).toBe(200);
    expect(await unauthorizedMsgRes.json()).toEqual({
      ok: true,
      ignored: "unauthorized",
    });

    const unauthorizedCallbackRes = await POST(
      new Request("http://localhost/api/webhook/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify({
          update_id: 1002,
          callback_query: {
            id: "cb-unauth-1",
            from: { id: 111222333 },
            message: {
              message_id: 11,
              chat: { id: 111222333 },
            },
            data: "retry:nonexistent-id",
          },
        }),
      })
    );
    expect(unauthorizedCallbackRes.status).toBe(200);
    expect(await unauthorizedCallbackRes.json()).toEqual({
      ok: true,
      ignored: "unauthorized",
    });

    expect(
      fetchCalls.filter((c) => c.url.startsWith("https://macrodroid.mock.local"))
        .length
    ).toBe(0);

    const authorizedTextRes = await POST(
      new Request("http://localhost/api/webhook/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify({
          update_id: 1003,
          message: {
            message_id: 12,
            chat: { id: 777888999 },
            text: "kopi kenangan 25rb pakai jago",
          },
        }),
      })
    );
    expect(authorizedTextRes.status).toBe(200);

    const authorizedPhotoRes = await POST(
      new Request("http://localhost/api/webhook/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify({
          update_id: 1004,
          message: {
            message_id: 13,
            chat: { id: 777888999 },
            caption: "struk kopi",
            photo: [{ file_id: "photo-file-1", file_size: 1024 }],
          },
        }),
      })
    );
    expect(authorizedPhotoRes.status).toBe(200);

    const logIds = redisState.lists.get("mm:logs:ids") ?? [];
    expect(logIds.length).toBe(2);
    const targetLogId = logIds[0];

    const authorizedCallbackRes = await POST(
      new Request("http://localhost/api/webhook/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify({
          update_id: 1005,
          callback_query: {
            id: "cb-auth-1",
            from: { id: 777888999 },
            message: {
              message_id: 14,
              chat: { id: 777888999 },
            },
            data: `retry:${targetLogId}`,
          },
        }),
      })
    );
    expect(authorizedCallbackRes.status).toBe(200);
    expect(
      fetchCalls.some((c) => c.url.includes("/answerCallbackQuery"))
    ).toBe(true);
    expect(
      fetchCalls.filter((c) => c.url.startsWith("https://macrodroid.mock.local"))
        .length
    ).toBe(3);
  });

  it("serves authenticated /health, /logs, /logs/:id/retry, /logs/export, and /device/ping", async () => {
    process.env.ALLOWED_CHAT_ID = "777888999, 111000111";
    await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          app_package: "com.jago.digitalBanking",
          app_name: "Jago",
          title: "QRIS",
          text: "Kopi Kenangan Rp25.000",
        }),
      })
    );
    const tgSendCall = fetchCalls.find((c) => c.url.includes("/sendMessage"));
    expect(tgSendCall).toBeDefined();
    const tgSendBody = JSON.parse(tgSendCall?.bodyText ?? "{}") as {
      chat_id?: string;
    };
    expect(tgSendBody.chat_id).toBe("777888999");

    const cookie = await loginAndGetCookie();

    const invalidLogsQuery = await GET(
      new Request("http://localhost/api/logs?status=UNKNOWN", {
        headers: { cookie },
      })
    );
    expect(invalidLogsQuery.status).toBe(400);

    const logsRes = await GET(
      new Request("http://localhost/api/logs", {
        headers: { cookie },
      })
    );
    expect(logsRes.status).toBe(200);
    const logsData = (await logsRes.json()) as {
      ok: boolean;
      logs: TransactionLogItem[];
      total: number;
    };
    expect(logsData.ok).toBe(true);
    expect(logsData.logs).toHaveLength(1);
    const logId = logsData.logs[0].id;

    await POST(
      new Request("http://localhost/api/webhook/ack", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          log_id: logId,
          status: "RECORDED",
        }),
      })
    );

    geminiNextResponse = {
      ignore: true,
      reason: "Promo",
      transactions: [],
    };
    await POST(
      new Request("http://localhost/api/webhook/macrodroid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-macrodroid-secret": "test-macrodroid-secret",
        },
        body: JSON.stringify({
          app_package: "com.jago.digitalBanking",
          app_name: "Jago",
          title: "Promo Cashback",
          text: "Gratis ongkir hari ini",
        }),
      })
    );

    const filteredExportRes = await GET(
      new Request("http://localhost/api/logs/export?status=RECORDED&limit=1", {
        headers: { cookie },
      })
    );
    expect(filteredExportRes.status).toBe(200);
    const filteredXlsx = new Uint8Array(await filteredExportRes.arrayBuffer());
    const filteredWb = new ExcelJS.Workbook();
    await filteredWb.xlsx.load(
      filteredXlsx.buffer as unknown as ExcelJS.Buffer
    );
    expect(filteredWb.worksheets[0].rowCount).toBe(2);
    expect(filteredWb.worksheets[0].getRow(2).getCell(5).value).toBe(
      "kopi kenangan"
    );

    const retryRes = await POST(
      new Request(`http://localhost/api/logs/${logId}/retry`, {
        method: "POST",
        headers: { cookie },
      })
    );
    expect(retryRes.status).toBe(200);
    const retryJson = (await retryRes.json()) as {
      ok: boolean;
      log: TransactionLogItem;
    };
    expect(retryJson.ok).toBe(true);
    expect(retryJson.log.retryCount).toBe(1);

    const missingRetryRes = await POST(
      new Request("http://localhost/api/logs/nonexistent-id/retry", {
        method: "POST",
        headers: { cookie },
      })
    );
    expect(missingRetryRes.status).toBe(404);

    const exportRes = await GET(
      new Request("http://localhost/api/logs/export", {
        headers: { cookie },
      })
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(exportRes.headers.get("content-disposition")).toContain("attachment");

    const xlsxBytes = new Uint8Array(await exportRes.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBytes.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(5).value).toBe("kopi kenangan");

    const pingRes = await POST(
      new Request("http://localhost/api/device/ping", {
        method: "POST",
        headers: { cookie },
      })
    );
    expect(pingRes.status).toBe(200);
    const pingBody = (await pingRes.json()) as {
      ok: boolean;
      reachable: boolean;
    };
    expect(pingBody.ok).toBe(true);
    expect(pingBody.reachable).toBe(true);

    const healthRes = await GET(
      new Request("http://localhost/api/health", {
        headers: { cookie },
      })
    );
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as {
      ok: boolean;
      overallStatus: string;
      redis: { status: string };
      telegram: { status: string };
    };
    expect(healthBody.ok).toBe(true);
    expect(healthBody.redis.status).toBe("ONLINE");
    expect(healthBody.telegram.status).toBe("ONLINE");
  });
});
