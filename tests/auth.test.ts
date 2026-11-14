import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  timingSafeCompare,
  verifyDashboardPasscode,
  verifyMacrodroidSecret,
  verifySessionToken,
  verifyTelegramSecret,
} from "../src/lib/auth";
import { ConfigError } from "../src/lib/errors";

const ENV_KEYS = [
  "DASHBOARD_PASSCODE",
  "SESSION_SECRET",
  "MACRODROID_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
] as const;

describe("Auth & Secret Verification", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    setSystemTime();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("uses expected session cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("mm_session");
  });

  it("compares strings safely regardless of length or unicode content", () => {
    expect(timingSafeCompare("secret-123", "secret-123")).toBe(true);
    expect(timingSafeCompare("secret-123", "secret-124")).toBe(false);
    expect(timingSafeCompare("short", "much-longer-secret")).toBe(false);
    expect(timingSafeCompare("", "")).toBe(true);
    expect(timingSafeCompare("", "non-empty")).toBe(false);
    expect(timingSafeCompare("pin-kopi-é", "pin-kopi-é")).toBe(true);
    expect(timingSafeCompare("pin-kopi-é", "pin-kopi-e")).toBe(false);
  });

  it("validates dashboard passcode and fails closed when unconfigured", () => {
    expect(() => verifyDashboardPasscode("123456")).toThrow(ConfigError);

    process.env.DASHBOARD_PASSCODE = "   ";
    expect(() => verifyDashboardPasscode("   ")).toThrow(ConfigError);

    process.env.DASHBOARD_PASSCODE = "246810";
    expect(verifyDashboardPasscode("246810")).toBe(true);
    expect(verifyDashboardPasscode("000000")).toBe(false);
    expect(verifyDashboardPasscode("246810 ")).toBe(false);
    expect(verifyDashboardPasscode("")).toBe(false);
  });

  it("signs, verifies, and rejects tampered or expired HMAC session tokens", () => {
    expect(() => createSessionToken()).toThrow(ConfigError);

    process.env.DASHBOARD_PASSCODE = "passcode-only-fallback";
    const fallbackSession = createSessionToken();
    expect(fallbackSession.maxAgeSeconds).toBe(7 * 24 * 60 * 60);
    expect(verifySessionToken(fallbackSession.token).valid).toBe(true);

    process.env.SESSION_SECRET = "dedicated-hmac-secret-value";
    expect(verifySessionToken(fallbackSession.token).valid).toBe(false);

    setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
    const session = createSessionToken();
    expect(session.token.length).toBeGreaterThan(20);
    expect(session.maxAgeSeconds).toBe(604800);

    const verified = verifySessionToken(session.token);
    expect(verified.valid).toBe(true);
    expect(verified.expiresAt).toBe(session.expiresAt);

    expect(verifySessionToken(undefined).valid).toBe(false);
    expect(verifySessionToken(null).valid).toBe(false);
    expect(verifySessionToken("").valid).toBe(false);
    expect(verifySessionToken("not-a-valid-token").valid).toBe(false);

    const parts = session.token.split(".");
    expect(parts.length).toBe(2);
    const tamperedSig = `${parts[0]}.${parts[1].slice(0, -2)}aa`;
    expect(verifySessionToken(tamperedSig).valid).toBe(false);

    const decodedPayload = Buffer.from(parts[0], "base64url").toString("utf8");
    const tamperedPayload = Buffer.from(`${decodedPayload} `, "utf8").toString(
      "base64url"
    );
    expect(verifySessionToken(`${tamperedPayload}.${parts[1]}`).valid).toBe(
      false
    );

    setSystemTime(new Date("2026-11-21T10:00:02.000Z"));
    expect(verifySessionToken(session.token).valid).toBe(false);
  });

  it("enforces fail-closed webhook secret checks for MacroDroid and Telegram", () => {
    expect(verifyMacrodroidSecret("anything")).toBe(false);
    expect(verifyMacrodroidSecret("")).toBe(false);
    expect(verifyMacrodroidSecret(null)).toBe(false);
    expect(verifyMacrodroidSecret(undefined)).toBe(false);

    process.env.MACRODROID_SECRET = "macro-secret-xyz";
    expect(verifyMacrodroidSecret("macro-secret-xyz")).toBe(true);
    expect(verifyMacrodroidSecret("wrong-secret")).toBe(false);
    expect(verifyMacrodroidSecret(undefined)).toBe(false);

    expect(verifyTelegramSecret("anything")).toBe(false);
    expect(verifyTelegramSecret("")).toBe(false);
    expect(verifyTelegramSecret(null)).toBe(false);

    process.env.TELEGRAM_WEBHOOK_SECRET = "tg-secret-abc";
    expect(verifyTelegramSecret("tg-secret-abc")).toBe(true);
    expect(verifyTelegramSecret("tg-secret-abd")).toBe(false);
    expect(verifyTelegramSecret(undefined)).toBe(false);
  });
});
