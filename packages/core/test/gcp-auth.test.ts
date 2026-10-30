/// <reference types="node" />
import { createHash, createPublicKey, createVerify, verify } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import {
  authHeaders,
  clearTokenCache,
  credentialsProblem,
  getAccessToken,
  rsaSha256Sign,
  serviceAccountJwt,
  signedUrlV4,
  type AuthorizedUser,
  type ServiceAccountKey,
} from "../src/gcp/auth.ts";
import { base64ToBytes } from "../src/gcp/base64.ts";
import { fixtureJson, fixtureText, mockFetch } from "./gcp-helpers.ts";

const sa = fixtureJson<ServiceAccountKey>("service-account.json");
const user = fixtureJson<AuthorizedUser>("authorized-user.json");
const publicKey = createPublicKey(fixtureText("throwaway-rsa-pub.pem"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokenCache();
});

function verifyRs256(data: string, signature: Uint8Array): boolean {
  return verify("sha256", Buffer.from(data), publicKey, Buffer.from(signature));
}

test("credentialsProblem accepts both credential types and rejects others", () => {
  expect(credentialsProblem(sa)).toBeNull();
  expect(credentialsProblem(user)).toBeNull();
  expect(credentialsProblem({ type: "external_account" })).toMatch(/Unsupported/);
  expect(credentialsProblem({ type: "authorized_user", client_id: "x" })).toMatch(/refresh_token/);
  expect(credentialsProblem({ client_email: "a@b" })).toMatch(/private_key/);
  expect(credentialsProblem("nope")).toMatch(/JSON object/);
});

test("service account JWT is RS256-signed and verifies with node:crypto", async () => {
  const jwt = await serviceAccountJwt(sa, "https://www.googleapis.com/auth/cloud-platform", 1_700_000_000);
  const [h, c, s] = jwt.split(".") as [string, string, string];
  expect(JSON.parse(new TextDecoder().decode(base64ToBytes(h)))).toEqual({ alg: "RS256", typ: "JWT" });
  expect(JSON.parse(new TextDecoder().decode(base64ToBytes(c)))).toEqual({
    iss: "viewer@demo-project-123.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  expect(verifyRs256(`${h}.${c}`, base64ToBytes(s))).toBe(true);
});

test("pure-JS signer (no crypto.subtle) produces the same deterministic signature", async () => {
  const viaSubtle = await rsaSha256Sign(sa.private_key, "hello");
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const viaPureJs = await rsaSha256Sign(sa.private_key, "hello");
  vi.stubGlobal("crypto", undefined);
  const unblinded = await rsaSha256Sign(sa.private_key, "hello");
  expect(viaPureJs).toEqual(viaSubtle);
  expect(unblinded).toEqual(viaSubtle);
  expect(verifyRs256("hello", viaPureJs)).toBe(true);
});

test("pure-JS signer reads PKCS#1 'BEGIN RSA PRIVATE KEY' keys", async () => {
  const sig = await rsaSha256Sign(fixtureText("throwaway-rsa-key-pkcs1.pem"), "pkcs1");
  const v = createVerify("sha256");
  v.update("pkcs1");
  expect(v.verify(publicKey, Buffer.from(sig))).toBe(true);
});

test("getAccessToken exchanges a JWT once and caches per credential and scope", async () => {
  const calls = mockFetch(() => undefined);
  expect(await getAccessToken(sa)).toBe("ya29.fake-access-token");
  expect(await getAccessToken(sa)).toBe("ya29.fake-access-token");
  expect(calls).toHaveLength(1);
  const body = new URLSearchParams(calls[0]!.body);
  expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [h, c, s] = body.get("assertion")!.split(".") as [string, string, string];
  expect(verifyRs256(`${h}.${c}`, base64ToBytes(s))).toBe(true);

  await getAccessToken(sa, "https://www.googleapis.com/auth/devstorage.read_write");
  expect(calls).toHaveLength(2);
});

test("authHeaders for a user refreshes the token and adds the quota project", async () => {
  const calls = mockFetch(() => undefined);
  const headers = await authHeaders(user);
  expect(headers).toEqual({
    Authorization: "Bearer ya29.fake-access-token",
    "x-goog-user-project": "demo-project-123",
  });
  const body = new URLSearchParams(calls[0]!.body);
  expect(body.get("grant_type")).toBe("refresh_token");
  expect(body.get("refresh_token")).toBe(user.refresh_token);
  expect(await authHeaders(sa)).toEqual({ Authorization: "Bearer ya29.fake-access-token" });
});

test("token exchange errors surface Google's error_description", async () => {
  vi.stubGlobal("fetch", async () => new Response(fixtureText("error-401-token.json"), { status: 400 }));
  await expect(getAccessToken(user)).rejects.toThrow("400 invalid_grant: Token has been expired or revoked.");
});

test("signedUrlV4 builds a GOOG4-RSA-SHA256 URL whose signature verifies", async () => {
  const url = new URL(
    await signedUrlV4({ serviceAccount: sa, bucket: "my-bucket", object: "dir/a b.txt", now: new Date("2024-01-02T03:04:05Z") })
  );
  expect(url.pathname).toBe("/my-bucket/dir/a%20b.txt");
  expect(url.searchParams.get("X-Goog-Credential")).toBe(
    "viewer@demo-project-123.iam.gserviceaccount.com/20240102/auto/storage/goog4_request"
  );
  expect(url.searchParams.get("X-Goog-Date")).toBe("20240102T030405Z");
  const signature = url.searchParams.get("X-Goog-Signature")!;
  expect(signature).toMatch(/^[0-9a-f]{512}$/);
  url.searchParams.delete("X-Goog-Signature");
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = ["GET", url.pathname, canonicalQuery, "host:storage.googleapis.com\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    "20240102T030405Z",
    "20240102/auto/storage/goog4_request",
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  expect(verifyRs256(stringToSign, Buffer.from(signature, "hex"))).toBe(true);
});
