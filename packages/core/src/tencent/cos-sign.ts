// Tencent COS request signing (signature v5, HMAC-SHA1) — COS predates the
// unified API 3.0 signer and keeps its own.
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { TencentKey } from "./tc3.ts";

function hmacSha1Hex(key: string, data: string): string {
  return bytesToHex(hmac(sha1, utf8ToBytes(key), utf8ToBytes(data)));
}

/** Strict: only unreserved characters left bare. */
function strict(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function sortedPairs(items: [string, string][]): [string, string][] {
  return items
    .map(([k, v]): [string, string] => [k.toLowerCase(), strict(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
}

function canonicalPath(url: URL): string {
  const path = url.pathname || "/";
  return path
    .split("/")
    .map((seg) => {
      try {
        return strict(decodeURIComponent(seg));
      } catch {
        return strict(seg);
      }
    })
    .join("/");
}

export interface CosSignInput extends TencentKey {
  method: string;
  url: string;
  headers?: Record<string, string>;
  now?: Date;
  validFor?: number;
}

export function cosAuthorization(input: CosSignInput): string {
  const start = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const keyTime = `${start};${start + (input.validFor ?? 3600)}`;
  const signKey = hmacSha1Hex(input.secretKey, keyTime);
  const url = new URL(input.url);

  const queryPairs = sortedPairs([...url.searchParams.entries()]);
  const headerPairs = sortedPairs(Object.entries(input.headers ?? {}));
  const httpString =
    `${input.method.toLowerCase()}\n${canonicalPath(url)}\n` +
    `${queryPairs.map(([k, v]) => `${k}=${v}`).join("&")}\n` +
    `${headerPairs.map(([k, v]) => `${k}=${v}`).join("&")}\n`;
  const stringToSign = `sha1\n${keyTime}\n${bytesToHex(sha1(utf8ToBytes(httpString)))}\n`;
  const signature = hmacSha1Hex(signKey, stringToSign);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${input.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerPairs.map(([k]) => k).join(";")}`,
    `q-url-param-list=${queryPairs.map(([k]) => k).join(";")}`,
    `q-signature=${signature}`,
  ].join("&");
}

/** `headers` are the ones the request actually carries — all must be signed. */
export function cosHeaders(input: CosSignInput): Record<string, string> {
  const out: Record<string, string> = { ...(input.headers ?? {}), Authorization: cosAuthorization(input) };
  if (input.token) out["x-cos-security-token"] = input.token;
  return out;
}

/** Shareable link: same signature carried as `sign=`. */
export function cosPresignedUrl(input: Omit<CosSignInput, "headers"> & { expiresIn?: number }): string {
  const authorization = cosAuthorization({ ...input, validFor: input.expiresIn ?? input.validFor ?? 3600 });
  const url = new URL(input.url);
  url.searchParams.append("sign", authorization);
  if (input.token) url.searchParams.append("x-cos-security-token", input.token);
  return url.toString();
}
