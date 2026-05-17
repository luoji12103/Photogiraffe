import type { NextRequest } from "next/server";

export const GO_CORE_URL =
  process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

type RequestLike = Pick<Request, "headers"> | Pick<NextRequest, "headers">;

export function getAuthorizationHeader(request: RequestLike): string {
  return request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
}

export function buildProxyHeaders(
  request: RequestLike,
  init: HeadersInit = {}
): Headers {
  const headers = new Headers(init);
  const authorization = getAuthorizationHeader(request);
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  const csrfToken = request.headers.get("x-csrf-token") ?? request.headers.get("X-Csrf-Token");
  if (csrfToken) {
    headers.set("X-Csrf-Token", csrfToken);
  }
  return headers;
}
