import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConfigError } from "./errors";

export const SESSION_COOKIE_NAME = "mm_session";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  iat: number;
  exp: number;
  jti: string;
}

function getSessionSigningSecret(): string | null {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret) {
    return sessionSecret;
  }
  const passcode = process.env.DASHBOARD_PASSCODE?.trim();
  if (passcode) {
    return passcode;
  }
  return null;
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

export function timingSafeCompare(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

export function verifyDashboardPasscode(inputPasscode: string): boolean {
  const expected = process.env.DASHBOARD_PASSCODE?.trim();
  if (!expected) {
    throw new ConfigError("DASHBOARD_PASSCODE environment variable is missing");
  }
  if (typeof inputPasscode !== "string" || inputPasscode.length === 0) {
    return false;
  }
  return timingSafeCompare(inputPasscode, expected);
}

export function createSessionToken(): {
  token: string;
  expiresAt: string;
  maxAgeSeconds: number;
} {
  const secret = getSessionSigningSecret();
  if (!secret) {
    throw new ConfigError(
      "SESSION_SECRET or DASHBOARD_PASSCODE environment variable is missing"
    );
  }

  const nowMs = Date.now();
  const expiresAtMs = nowMs + SESSION_TTL_SECONDS * 1000;
  const payload: SessionPayload = {
    iat: nowMs,
    exp: expiresAtMs,
    jti: randomBytes(16).toString("hex"),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    maxAgeSeconds: SESSION_TTL_SECONDS,
  };
}

export function verifySessionToken(
  token: string | undefined | null
): { valid: boolean; expiresAt?: string } {
  if (!token || typeof token !== "string") {
    return { valid: false };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false };
  }

  const [encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) {
    return { valid: false };
  }

  const secret = getSessionSigningSecret();
  if (!secret) {
    return { valid: false };
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeCompare(providedSignature, expectedSignature)) {
    return { valid: false };
  }

  let parsed: unknown;
  try {
    const jsonString = Buffer.from(encodedPayload, "base64url").toString("utf8");
    parsed = JSON.parse(jsonString);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { valid: false };
    }
    throw err;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as SessionPayload).exp !== "number" ||
    !Number.isFinite((parsed as SessionPayload).exp) ||
    typeof (parsed as SessionPayload).iat !== "number"
  ) {
    return { valid: false };
  }

  const expMs = (parsed as SessionPayload).exp;
  if (Date.now() >= expMs) {
    return { valid: false };
  }

  return {
    valid: true,
    expiresAt: new Date(expMs).toISOString(),
  };
}

export function verifyMacrodroidSecret(
  headerValue: string | undefined | null
): boolean {
  const expected = process.env.MACRODROID_SECRET?.trim();
  if (!expected || !headerValue) {
    return false;
  }
  return timingSafeCompare(headerValue, expected);
}

export function verifyTelegramSecret(
  headerValue: string | undefined | null
): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected || !headerValue) {
    return false;
  }
  return timingSafeCompare(headerValue, expected);
}
