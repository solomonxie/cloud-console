// Pure-JS SHA-256/HMAC so the same signing code runs in Chrome and in
// React Native (Hermes has no crypto.subtle).
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export type Bytes = Uint8Array;

export function toBytes(data: string | Bytes): Bytes {
  return typeof data === "string" ? utf8ToBytes(data) : data;
}

export function sha256Hex(data: string | Bytes): string {
  return bytesToHex(sha256(toBytes(data)));
}

export function hmacSha256(key: string | Bytes, data: string | Bytes): Bytes {
  return hmac(sha256, toBytes(key), toBytes(data));
}

export function hmacSha256Hex(key: string | Bytes, data: string | Bytes): string {
  return bytesToHex(hmacSha256(key, data));
}

export { bytesToHex };

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeRFC3986).join("/");
}

// Sorted, RFC 3986-encoded query string — the canonical form SigV4, TC3
// and GOOG4 signatures are all computed over.
export function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeRFC3986(k)}=${encodeRFC3986(v)}`)
    .join("&");
}
