// AWS Signature Version 4 — header signing for API calls and query-string
// presigning for share links. Shared by every AWS client and by the
// S3-compatible storage types (R2, MinIO, Tencent COS, Alibaba OSS).
import {
  EMPTY_SHA256,
  bytesToHex,
  canonicalQuery,
  encodePath,
  hmacSha256,
  sha256Hex,
  type Bytes,
} from "../crypto/hash.ts";

export interface AwsKey {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput extends AwsKey {
  method: string;
  url: string;
  region: string;
  service: string;
  headers?: Record<string, string>;
  // Hex SHA-256 of the body; computed from `body` when omitted.
  payloadHash?: string;
  body?: string | Bytes;
  // Injectable for tests against AWS's published vectors.
  now?: Date;
  // S3 wants x-amz-content-sha256 on every request; other services don't.
  contentSha256Header?: boolean;
}

function amzDates(now: Date) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Bytes {
  const kDate = hmacSha256("AWS4" + secret, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

// Returns the full header set (including Authorization) to send.
export function signRequest(input: SignInput): Record<string, string> {
  const { amzDate, dateStamp } = amzDates(input.now ?? new Date());
  const parsed = new URL(input.url);
  const hash =
    input.payloadHash ?? (input.body !== undefined ? sha256Hex(input.body) : EMPTY_SHA256);

  const allHeaders: Record<string, string> = {
    host: parsed.host,
    "x-amz-date": amzDate,
    ...(input.contentSha256Header !== false && input.service === "s3"
      ? { "x-amz-content-sha256": hash }
      : {}),
    ...(input.sessionToken ? { "x-amz-security-token": input.sessionToken } : {}),
    ...input.headers,
  };

  const lookup = Object.fromEntries(
    Object.entries(allHeaders).map(([k, v]) => [k.toLowerCase(), String(v).trim()])
  );
  const sortedKeys = Object.keys(lookup).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${lookup[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    input.method,
    encodePath(decodeURIComponent(parsed.pathname)) || "/",
    canonicalQuery(parsed.searchParams),
    canonicalHeaders,
    signedHeaders,
    hash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = signingKey(input.secretAccessKey, dateStamp, input.region, input.service);
  const signature = bytesToHex(hmacSha256(key, stringToSign));

  const { host: _host, ...headers } = allHeaders;
  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface PresignInput extends AwsKey {
  method?: string;
  url: string;
  region: string;
  service?: string;
  expiresIn?: number;
  now?: Date;
}

// Query-string signing: the signature rides in the URL so the link works
// pasted into a browser, until it expires.
export function presignUrl(input: PresignInput): string {
  const service = input.service ?? "s3";
  const { amzDate, dateStamp } = amzDates(input.now ?? new Date());
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;

  const parsed = new URL(input.url);
  parsed.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  parsed.searchParams.set("X-Amz-Credential", `${input.accessKeyId}/${scope}`);
  parsed.searchParams.set("X-Amz-Date", amzDate);
  parsed.searchParams.set("X-Amz-Expires", String(input.expiresIn ?? 3600));
  if (input.sessionToken) parsed.searchParams.set("X-Amz-Security-Token", input.sessionToken);
  parsed.searchParams.set("X-Amz-SignedHeaders", "host");

  const canonicalRequest = [
    input.method ?? "GET",
    encodePath(decodeURIComponent(parsed.pathname)) || "/",
    canonicalQuery(parsed.searchParams),
    `host:${parsed.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = signingKey(input.secretAccessKey, dateStamp, input.region, service);
  parsed.searchParams.set("X-Amz-Signature", bytesToHex(hmacSha256(key, stringToSign)));
  return parsed.toString();
}
