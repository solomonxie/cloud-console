// Tencent Cloud API 3.0 signature (TC3-HMAC-SHA256). Same canonical-request /
// string-to-sign / HMAC-chain shape as SigV4, with Tencent's header names and
// POST-JSON action-per-request style.
import { bytesToHex, hmacSha256, sha256Hex, type Bytes } from "../crypto/hash.ts";

export interface TencentKey {
  secretId: string;
  secretKey: string;
  token?: string;
}

export interface TC3Input extends TencentKey {
  host: string;
  service: string;
  action: string;
  version: string;
  region?: string;
  payload: string | Bytes;
  /** Injectable for tests against Tencent's documented example. */
  now?: Date;
  contentType?: string;
  /** Also sign x-tc-action (the Swift app does; Tencent's 2019 doc example doesn't). Default true. */
  signAction?: boolean;
}

export interface TC3Signature {
  authorization: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export function tc3Sign(input: TC3Input): TC3Signature {
  const now = input.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const dateStamp = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = input.contentType ?? "application/json; charset=utf-8";

  const signAction = input.signAction ?? true;
  const canonicalHeaders =
    `content-type:${contentType}\nhost:${input.host}\n` + (signAction ? `x-tc-action:${input.action.toLowerCase()}\n` : "");
  const signedHeaders = signAction ? "content-type;host;x-tc-action" : "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256Hex(input.payload)].join("\n");

  const credentialScope = `${dateStamp}/${input.service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const secretDate = hmacSha256(`TC3${input.secretKey}`, dateStamp);
  const secretService = hmacSha256(secretDate, input.service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = bytesToHex(hmacSha256(secretSigning, stringToSign));

  const authorization = `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, canonicalRequest, stringToSign, signature };
}

/** Headers to attach (Authorization, Content-Type, Host, X-TC-*). */
export function tc3Headers(input: TC3Input): Record<string, string> {
  const now = input.now ?? new Date();
  const { authorization } = tc3Sign({ ...input, now });
  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": input.contentType ?? "application/json; charset=utf-8",
    Host: input.host,
    "X-TC-Action": input.action,
    "X-TC-Timestamp": String(Math.floor(now.getTime() / 1000)),
    "X-TC-Version": input.version,
  };
  if (input.region) headers["X-TC-Region"] = input.region;
  if (input.token) headers["X-TC-Token"] = input.token;
  return headers;
}
