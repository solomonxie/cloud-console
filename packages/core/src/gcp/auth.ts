// Google Cloud auth from a credentials JSON file — the same two
// non-interactive credential types GCP's own client libraries take:
// - "service_account": a service account JSON key.
// - "authorized_user": gcloud's application default credentials
//   (~/.config/gcloud/application_default_credentials.json, written by
//   `gcloud auth application-default login`) — a user refresh token.
//
// API calls authenticate with a short-lived OAuth2 access token. A service
// account gets one via the JWT Bearer Token flow (RFC 7523): sign a JWT with
// its RSA private key, exchange it for a token. An authorized user exchanges
// its refresh token (RFC 6749 section 6). Neither needs a consent screen.
//
// RSA-SHA256 (PKCS#1 v1.5) signing uses crypto.subtle when the runtime has
// it (Chrome) and falls back to pure JS (micro-rsa-dsa-dh, built on the
// same @noble/hashes we already use) where it doesn't (React Native/Hermes).

import { PKCS1_SHA256 } from "micro-rsa-dsa-dh/rsa.js";
import { bytesToHex, canonicalQuery, encodePath, sha256Hex, toBytes } from "../crypto/hash.ts";
import { base64ToBytes, bytesToBase64Url } from "./base64.ts";

export const SCOPE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

const TOKEN_URI = "https://oauth2.googleapis.com/token";

export interface ServiceAccountKey {
  type?: "service_account";
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export interface AuthorizedUser {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
  token_uri?: string;
}

export type GoogleCredentials = ServiceAccountKey | AuthorizedUser;

const CREDENTIAL_TYPES = ["service_account", "authorized_user"];

// Returns an error message for a parsed credentials file this module can't
// use, or null when it's fine.
export function credentialsProblem(creds: unknown): string | null {
  if (!creds || typeof creds !== "object") return "Credentials must be a JSON object.";
  const c = creds as Record<string, unknown>;
  if (c.type === "authorized_user") {
    if (!c.client_id || !c.client_secret || !c.refresh_token) {
      return "Credentials file is missing client_id, client_secret or refresh_token.";
    }
    return null;
  }
  if (c.type && !CREDENTIAL_TYPES.includes(c.type as string)) {
    return `Unsupported credentials type "${String(c.type)}" — use a service account key or gcloud application default credentials.`;
  }
  if (!c.client_email || !c.private_key) {
    return "JSON key is missing client_email or private_key.";
  }
  return null;
}

export function canSign(creds: GoogleCredentials): creds is ServiceAccountKey {
  return creds.type !== "authorized_user";
}

// ---------------------------------------------------------------------------
// RSA private key parsing (PEM → n, e, d) for the pure-JS signer.

interface RsaKey {
  n: bigint;
  e: bigint;
  d: bigint;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return base64ToBytes(b64);
}

// Minimal DER reader: just enough for PKCS#8 PrivateKeyInfo wrapping a
// PKCS#1 RSAPrivateKey.
class Der {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  read(expectedTag: number): Uint8Array {
    const tag = this.buf[this.pos++];
    if (tag !== expectedTag) {
      throw new Error(`Invalid private key: expected DER tag 0x${expectedTag.toString(16)}, got 0x${(tag ?? 0).toString(16)}`);
    }
    let len = this.buf[this.pos++]!;
    if (len & 0x80) {
      const count = len & 0x7f;
      len = 0;
      for (let i = 0; i < count; i++) len = len * 256 + this.buf[this.pos++]!;
    }
    const out = this.buf.subarray(this.pos, this.pos + len);
    if (out.length !== len) throw new Error("Invalid private key: truncated DER");
    this.pos += len;
    return out;
  }

  int(): bigint {
    const bytes = this.read(0x02);
    return bytes.length ? BigInt("0x" + bytesToHex(bytes)) : 0n;
  }
}

const SEQUENCE = 0x30;
const OCTET_STRING = 0x04;

function parsePkcs1(der: Uint8Array): RsaKey {
  const seq = new Der(new Der(der).read(SEQUENCE));
  seq.int(); // version
  const n = seq.int();
  const e = seq.int();
  const d = seq.int();
  return { n, e, d };
}

export function parseRsaPrivateKey(pem: string): RsaKey {
  const der = pemToDer(pem);
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) return parsePkcs1(der);
  const info = new Der(new Der(der).read(SEQUENCE));
  info.int(); // version
  info.read(SEQUENCE); // AlgorithmIdentifier (rsaEncryption)
  return parsePkcs1(info.read(OCTET_STRING));
}

// ---------------------------------------------------------------------------
// RSASSA-PKCS1-v1_5 / SHA-256.

function hasSubtle(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === "function";
}

function canRandom(): boolean {
  return typeof globalThis.crypto?.getRandomValues === "function";
}

async function signSubtle(pem: string, data: Uint8Array): Promise<Uint8Array> {
  if (!/BEGIN PRIVATE KEY/.test(pem)) throw new Error("subtle needs PKCS#8");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem) as Uint8Array<ArrayBuffer>,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data as Uint8Array<ArrayBuffer>);
  return new Uint8Array(sig);
}

function signPureJs(pem: string, data: Uint8Array): Uint8Array {
  const { n, e, d } = parseRsaPrivateKey(pem);
  // With e present the library blinds the private exponentiation, which
  // needs a CSPRNG; without one (bare Hermes) fall back to unblinded.
  const key = canRandom() ? { n, e, d } : { n, d };
  return PKCS1_SHA256.sign(key, data);
}

export async function rsaSha256Sign(pem: string, data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = toBytes(data);
  if (hasSubtle() && /BEGIN PRIVATE KEY/.test(pem)) {
    try {
      return await signSubtle(pem, bytes);
    } catch {
      // fall through to the pure-JS signer
    }
  }
  return signPureJs(pem, bytes);
}

// ---------------------------------------------------------------------------
// Access tokens.

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

async function postTokenRequest(url: string, body: string): Promise<CachedToken> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let detail = text;
    try {
      const j = JSON.parse(text) as { error?: string; error_description?: string };
      if (j.error) detail = j.error_description ? `${j.error}: ${j.error_description}` : j.error;
    } catch {
      // not JSON — keep raw text
    }
    throw new Error(`Google token exchange failed: ${resp.status} ${detail}`.trim());
  }
  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  const ttl = (data.expires_in ?? 3600) - 60;
  return { accessToken: data.access_token, expiresAt: Date.now() + ttl * 1000 };
}

function fetchUserAccessToken(creds: AuthorizedUser): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
  });
  return postTokenRequest(creds.token_uri || TOKEN_URI, body.toString());
}

export async function serviceAccountJwt(
  sa: ServiceAccountKey,
  scope: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const aud = sa.token_uri || TOKEN_URI;
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope, aud, iat: nowSeconds, exp: nowSeconds + 3600 };
  const unsigned = `${bytesToBase64Url(toBytes(JSON.stringify(header)))}.${bytesToBase64Url(toBytes(JSON.stringify(claims)))}`;
  const signature = await rsaSha256Sign(sa.private_key, unsigned);
  return `${unsigned}.${bytesToBase64Url(signature)}`;
}

async function fetchServiceAccountAccessToken(sa: ServiceAccountKey, scope: string): Promise<CachedToken> {
  const jwt = await serviceAccountJwt(sa, scope);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  return postTokenRequest(sa.token_uri || TOKEN_URI, body.toString());
}

// One cached token per (credential, scope), refreshed a minute before it
// actually expires. In-flight requests are shared so parallel callers don't
// each run a token exchange. Refresh-token scopes are fixed at gcloud login,
// so the scope only matters for service accounts.
const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

function cacheKey(creds: GoogleCredentials, scope: string): string {
  return creds.type === "authorized_user"
    ? `user:${creds.client_id}:${creds.refresh_token}`
    : `sa:${creds.client_email}:${scope}`;
}

export function clearTokenCache(): void {
  tokenCache.clear();
  inflight.clear();
}

export async function getAccessToken(
  creds: GoogleCredentials,
  scope: string = SCOPE_CLOUD_PLATFORM
): Promise<string> {
  const key = cacheKey(creds, scope);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  let pending = inflight.get(key);
  if (!pending) {
    pending =
      creds.type === "authorized_user"
        ? fetchUserAccessToken(creds)
        : fetchServiceAccountAccessToken(creds, scope);
    inflight.set(key, pending);
  }
  try {
    const fresh = await pending;
    tokenCache.set(key, fresh);
    return fresh.accessToken;
  } finally {
    inflight.delete(key);
  }
}

// Headers for a Google API call. User credentials bill some APIs (e.g.
// Resource Manager, Secret Manager) to a quota project, which ADC records as
// quota_project_id — pass it so those calls don't fail with "API requires a
// quota project".
export async function authHeaders(
  creds: GoogleCredentials,
  scope: string = SCOPE_CLOUD_PLATFORM
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken(creds, scope)}`,
  };
  if (creds.type === "authorized_user" && creds.quota_project_id) {
    headers["x-goog-user-project"] = creds.quota_project_id;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// GOOG4-RSA-SHA256 V4 signed URL — structurally the same as AWS SigV4
// query-string presigning, but RSA-signed with the service account's private
// key and scoped to the pseudo-region "auto".

export async function signedUrlV4(opts: {
  serviceAccount: ServiceAccountKey;
  bucket: string;
  object: string;
  method?: string;
  expiresIn?: number;
  now?: Date;
}): Promise<string> {
  const { serviceAccount, bucket, object, method = "GET", expiresIn = 3600, now = new Date() } = opts;
  const googDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = googDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/storage/goog4_request`;

  const host = "storage.googleapis.com";
  const canonicalUri = encodePath(`/${bucket}/${object}`) || "/";
  const url = new URL(`https://${host}${canonicalUri}`);
  url.searchParams.set("X-Goog-Algorithm", "GOOG4-RSA-SHA256");
  url.searchParams.set("X-Goog-Credential", `${serviceAccount.client_email}/${credentialScope}`);
  url.searchParams.set("X-Goog-Date", googDate);
  url.searchParams.set("X-Goog-Expires", String(expiresIn));
  url.searchParams.set("X-Goog-SignedHeaders", "host");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery(url.searchParams),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["GOOG4-RSA-SHA256", googDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = bytesToHex(await rsaSha256Sign(serviceAccount.private_key, stringToSign));
  url.searchParams.set("X-Goog-Signature", signature);
  return url.toString();
}
