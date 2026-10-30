// Shared REST helper for Google Cloud JSON APIs: auth headers, query
// building, Google's JSON error envelope, and pageToken pagination.

import { authHeaders, type GoogleCredentials } from "./auth.ts";

// Google's error envelope: { error: { code, message, status, details } }.
export class GcpApiError extends Error {
  readonly httpStatus: number;
  readonly status: string | undefined; // e.g. "PERMISSION_DENIED"
  readonly reason: string | undefined; // e.g. "SERVICE_DISABLED", from details[].reason or errors[].reason

  constructor(httpStatus: number, message: string, status?: string, reason?: string) {
    super(message);
    this.name = "GcpApiError";
    this.httpStatus = httpStatus;
    this.status = status;
    this.reason = reason;
  }

  get isPermissionDenied(): boolean {
    return this.httpStatus === 403;
  }

  get isNotFound(): boolean {
    return this.httpStatus === 404;
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string }[];
    details?: { reason?: string }[];
  };
}

export function errorFromBody(httpStatus: number, text: string): GcpApiError {
  let body: GoogleErrorBody | undefined;
  try {
    body = JSON.parse(text) as GoogleErrorBody;
  } catch {
    body = undefined;
  }
  const err = body?.error;
  if (!err) {
    return new GcpApiError(httpStatus, `HTTP ${httpStatus}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const reason = err.details?.find((d) => d.reason)?.reason ?? err.errors?.find((e) => e.reason)?.reason;
  const message = err.message || err.errors?.[0]?.message || `HTTP ${httpStatus}`;
  return new GcpApiError(httpStatus, message, err.status, reason);
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: string;
  query?: Query;
  body?: unknown;
}

export function buildUrl(base: string, query?: Query): string {
  if (!query) return base;
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function gcpRequest<T>(
  creds: GoogleCredentials,
  url: string,
  opts: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders(creds)) };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const resp = await fetch(buildUrl(url, opts.query), {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw errorFromBody(resp.status, text);
  }
  const text = await resp.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

// Follows nextPageToken until exhausted (or maxPages, a guard against a
// misbehaving API looping forever).
export async function collectPages<T>(
  fetchPage: (pageToken: string | undefined) => Promise<Page<T>>,
  maxPages = 100
): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(token);
    all.push(...page.items);
    token = page.nextPageToken;
    if (!token) break;
  }
  return all;
}

// Last path segment of a Google resource URL/name ("…/zones/us-central1-a" → "us-central1-a").
export function lastSegment(urlOrName: string | undefined): string {
  if (!urlOrName) return "";
  const parts = urlOrName.split("/");
  return parts[parts.length - 1] ?? "";
}
