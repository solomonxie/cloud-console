// One signed fetch for every AWS client. Uses the global fetch (Chrome, React
// Native, Node 18+); the key goes only to the provider's own endpoint.
import { signRequest, type AwsKey } from "./sigv4.ts";
import { parseJsonError, parseQueryError } from "./errors.ts";

export interface AwsCall {
  method?: string;
  url: string;
  region: string;
  service: string;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  /** How a non-2xx body is parsed into an error. */
  errors?: "xml" | "json";
}

export interface AwsResponse {
  status: number;
  headers: Headers;
  text: string;
}

export async function awsFetch(key: AwsKey, call: AwsCall): Promise<AwsResponse> {
  const method = call.method ?? "GET";
  const signed = signRequest({
    ...key,
    method,
    url: call.url,
    region: call.region,
    service: call.service,
    headers: call.headers,
    body: call.body,
  });
  const response = await fetch(call.url, {
    method,
    headers: signed,
    body: call.body === undefined || method === "GET" || method === "HEAD" ? undefined : (call.body as BodyInit),
  });
  const text = await response.text();
  if (response.status < 200 || response.status > 299) {
    throw call.errors === "json" ? parseJsonError(response.status, text) : parseQueryError(response.status, text);
  }
  return { status: response.status, headers: response.headers, text };
}

/** AWS JSON 1.1 protocol: POST + X-Amz-Target, JSON in and out. */
export async function awsJson<T = Record<string, unknown>>(
  key: AwsKey,
  opts: { url: string; region: string; service: string; target: string; body: unknown }
): Promise<T> {
  const response = await awsFetch(key, {
    method: "POST",
    url: opts.url,
    region: opts.region,
    service: opts.service,
    body: JSON.stringify(opts.body),
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": opts.target },
    errors: "json",
  });
  return (response.text ? JSON.parse(response.text) : {}) as T;
}

/** Query-API GET: `?Action=…&Version=…&…`. */
export function queryUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  return url.toString();
}
