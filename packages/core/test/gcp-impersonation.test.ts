import { afterEach, expect, test, vi } from "vitest";
import {
  authHeaders,
  canSign,
  clearTokenCache,
  credentialsProblem,
  getAccessToken,
  impersonate,
  impersonatedEmail,
  signedUrlV4,
  type AuthorizedUser,
  type ImpersonatedServiceAccount,
  type ServiceAccountKey,
} from "../src/gcp/auth.ts";
import { fixtureJson, mockFetch } from "./gcp-helpers.ts";

const sa = fixtureJson<ServiceAccountKey>("service-account.json");
const user = fixtureJson<AuthorizedUser>("authorized-user.json");
const adc = fixtureJson<ImpersonatedServiceAccount>("impersonated-adc.json");
const TARGET = "deployer@demo-project-123.iam.gserviceaccount.com";

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokenCache();
});

test("gcloud's impersonated ADC file is accepted", () => {
  expect(credentialsProblem(adc)).toBeNull();
  expect(impersonatedEmail(adc)).toBe(TARGET);
  expect(canSign(adc)).toBe(true);
  expect(credentialsProblem({ ...adc, service_account_impersonation_url: "x" })).toMatch(/impersonation_url/);
  expect(credentialsProblem({ ...adc, source_credentials: { type: "authorized_user" } })).toMatch(/refresh_token/);
});

test("impersonate wraps credentials and rejects a non-service-account email", () => {
  const wrapped = impersonate(user, ` ${TARGET} `);
  expect(wrapped.service_account_impersonation_url).toBe(adc.service_account_impersonation_url);
  expect(wrapped.source_credentials).toBe(user);
  expect(wrapped.delegates).toBeUndefined();
  expect(() => impersonate(user, "me@gmail.com")).toThrow(/isn't a service account email/);
});

test("impersonating from an impersonated file chains through delegates", () => {
  const chained = impersonate(adc, "reader@other-project.iam.gserviceaccount.com");
  expect(impersonatedEmail(chained)).toBe("reader@other-project.iam.gserviceaccount.com");
  expect(chained.source_credentials).toBe(adc.source_credentials);
  expect(chained.delegates).toEqual([TARGET]);
});

test("an impersonated token is minted by IAM Credentials with the source's token", async () => {
  const calls = mockFetch(({ url }) =>
    url.host === "iamcredentials.googleapis.com" ? { fixture: "iam-generate-access-token.json" } : undefined
  );
  const creds = impersonate(sa, TARGET);
  expect(await authHeaders(creds)).toEqual({ Authorization: "Bearer ya29.impersonated-token" });
  expect(await getAccessToken(creds)).toBe("ya29.impersonated-token");
  const iam = calls.filter((c) => c.url.host === "iamcredentials.googleapis.com");
  expect(iam).toHaveLength(1);
  expect(iam[0]!.url.pathname).toBe(`/v1/projects/-/serviceAccounts/${TARGET}:generateAccessToken`);
  expect(iam[0]!.headers.Authorization).toBe("Bearer ya29.fake-access-token");
  expect(JSON.parse(iam[0]!.body!)).toEqual({ scope: ["https://www.googleapis.com/auth/cloud-platform"], lifetime: "3600s" });
});

test("delegates are sent as resource names", async () => {
  const calls = mockFetch(({ url }) =>
    url.host === "iamcredentials.googleapis.com" ? { fixture: "iam-generate-access-token.json" } : undefined
  );
  await getAccessToken(impersonate(adc, "reader@other-project.iam.gserviceaccount.com"));
  const body = JSON.parse(calls.find((c) => c.url.host === "iamcredentials.googleapis.com")!.body!);
  expect(body.delegates).toEqual([`projects/-/serviceAccounts/${TARGET}`]);
});

test("a missing Token Creator grant surfaces Google's message", async () => {
  mockFetch(({ url }) =>
    url.host === "iamcredentials.googleapis.com" ? { status: 403, fixture: "error-403-token-creator.json" } : undefined
  );
  await expect(getAccessToken(impersonate(user, TARGET))).rejects.toThrow(
    `Impersonating ${TARGET} failed: 403 Permission 'iam.serviceAccounts.getAccessToken' denied`
  );
});

test("signed URLs for an impersonated account are signed with signBlob", async () => {
  const calls = mockFetch(({ url }) => (url.pathname.endsWith(":signBlob") ? { fixture: "iam-sign-blob.json" } : undefined));
  const url = new URL(
    await signedUrlV4({ serviceAccount: impersonate(user, TARGET), bucket: "b", object: "k.txt", now: new Date("2024-01-02T03:04:05Z") })
  );
  expect(url.searchParams.get("X-Goog-Credential")).toBe(`${TARGET}/20240102/auto/storage/goog4_request`);
  expect(url.searchParams.get("X-Goog-Signature")).toBe("deadbeef");
  const sign = calls.find((c) => c.url.pathname.endsWith(":signBlob"))!;
  expect(sign.url.pathname).toBe(`/v1/projects/-/serviceAccounts/${TARGET}:signBlob`);
  expect(atob(JSON.parse(sign.body!).payload)).toMatch(/^GOOG4-RSA-SHA256\n20240102T030405Z\n/);
});
