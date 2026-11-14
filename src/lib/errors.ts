export type ExternalServiceName =
  | "GEMINI"
  | "TELEGRAM"
  | "MACRODROID"
  | "REDIS";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.cause = cause;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 500, "CONFIG_ERROR", cause);
  }
}

export class AuthError extends AppError {
  constructor(message = "Unauthorized", cause?: unknown) {
    super(message, 401, "AUTH_ERROR", cause);
  }
}

export class ExternalServiceError extends AppError {
  readonly service: ExternalServiceName;

  constructor(
    service: ExternalServiceName,
    message: string,
    cause?: unknown
  ) {
    super(message, 502, "EXTERNAL_SERVICE_ERROR", cause);
    this.service = service;
  }
}
