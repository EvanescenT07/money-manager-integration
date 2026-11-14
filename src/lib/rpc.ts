import { hc, type ClientRequestOptions } from "hono/client";
import type { AppType } from "@/app/api/[[...route]]/route";

export function createApiClient(
  baseUrl = "",
  options?: ClientRequestOptions
) {
  return hc<AppType>(baseUrl, options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
