// Azure Blob Storage "Shared Key" request signing, and Service SAS
// query-string signing for presigned links — HMAC-SHA256 with the base64
// account key, no SDK, matching the S3 signer's approach (aws/sigv4.ts).
import { hmacSha256 } from "../crypto/hash.ts";
import { base64ToBytes, bytesToBase64 } from "../util/base64.ts";

export const API_VERSION = "2021-08-06";

export function hmacSha256Base64(base64Key: string, data: string): string {
  return bytesToBase64(hmacSha256(base64ToBytes(base64Key), data));
}

function canonicalizedHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-ms-"))
    .map(([k, v]) => [k.toLowerCase(), String(v).trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
}

function canonicalizedResource(accountName: string, url: string): string {
  const parsed = new URL(url);
  let resource = `/${accountName}${decodeURIComponent(parsed.pathname)}`;
  const params = new Map<string, string>();
  for (const [k, v] of parsed.searchParams.entries()) {
    const key = k.toLowerCase();
    const prev = params.get(key);
    params.set(key, prev !== undefined ? `${prev},${v}` : v);
  }
  for (const key of [...params.keys()].sort()) {
    resource += `\n${key}:${params.get(key)}`;
  }
  return resource;
}

export interface AzureSignInput {
  method: string;
  url: string;
  accountName: string;
  accountKey: string; // base64, as Azure hands it out
  headers?: Record<string, string>;
  // The body's byte length, kept separate from `headers` — Content-Length
  // isn't settable on a fetch() request (forbidden header name), but it's a
  // required, signed field: the runtime sends the real length automatically,
  // and it has to match what we signed.
  contentLength?: number;
  now?: Date; // injectable for tests
}

// Returns the full header set (including Authorization) to attach.
export function signRequest(input: AzureSignInput): Record<string, string> {
  const all: Record<string, string> = {
    "x-ms-date": (input.now ?? new Date()).toUTCString(),
    "x-ms-version": API_VERSION,
    ...input.headers,
  };

  const stringToSign =
    [
      input.method,
      all["content-encoding"] || "",
      all["content-language"] || "",
      input.contentLength ? String(input.contentLength) : "",
      all["content-md5"] || "",
      all["content-type"] || "",
      "", // Date — empty, x-ms-date is used instead
      all["if-modified-since"] || "",
      all["if-match"] || "",
      all["if-none-match"] || "",
      all["if-unmodified-since"] || "",
      all["range"] || "",
    ].join("\n") +
    "\n" +
    canonicalizedHeaders(all) +
    canonicalizedResource(input.accountName, input.url);

  const signature = hmacSha256Base64(input.accountKey, stringToSign);
  return { ...all, Authorization: `SharedKey ${input.accountName}:${signature}` };
}

export interface AzurePresignInput {
  url: string;
  accountName: string;
  accountKey: string;
  container: string; // raw (un-percent-encoded) names, as Azure defines
  blob: string; //      the resource string
  expiresIn?: number;
  now?: Date;
}

// Service SAS, read-only (signedPermissions "r") and query-string signed —
// the Azure equivalent of an S3 presigned URL.
export function presignUrl(input: AzurePresignInput): string {
  const now = input.now ?? new Date();
  const expiry = new Date(now.getTime() + (input.expiresIn ?? 3600) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const resource = `/blob/${input.accountName}/${input.container}/${input.blob}`;

  const stringToSign = [
    "r", // signed permissions
    "", // signed start
    expiry, // signed expiry
    resource, // canonicalized resource
    "", // signed identifier
    "", // signed IP
    "https", // signed protocol
    API_VERSION, // signed version
    "b", // signed resource (blob)
    "", // signed snapshot time
    "", // signed encryption scope
    "", // rscc
    "", // rscd
    "", // rsce
    "", // rscl
    "", // rsct
  ].join("\n");

  const parsed = new URL(input.url);
  parsed.searchParams.set("sv", API_VERSION);
  parsed.searchParams.set("sr", "b");
  parsed.searchParams.set("sp", "r");
  parsed.searchParams.set("se", expiry);
  parsed.searchParams.set("spr", "https");
  parsed.searchParams.set("sig", hmacSha256Base64(input.accountKey, stringToSign));
  return parsed.toString();
}
