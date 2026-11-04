import { expect, test } from "vitest";
import { accountCredentials, credentialsLabel, defaultProject, parseCredentials } from "../src/gcp/credentials.ts";
import { decodeSecretPayload } from "../src/gcp/secrets.ts";

const sa = JSON.stringify({ type: "service_account", client_email: "phone@demo-project.iam.gserviceaccount.com", private_key: "k", project_id: "demo-project" });
const adc = JSON.stringify({ type: "authorized_user", client_id: "c", client_secret: "s", refresh_token: "r", quota_project_id: "quota-proj" });

test("parseCredentials rejects junk with a readable message", () => {
  expect(() => parseCredentials("not json")).toThrow("Credentials aren't valid JSON.");
  expect(() => parseCredentials("{}")).toThrow(/client_email/);
});

test("defaultProject reads a key's project_id or ADC's quota project", () => {
  expect(defaultProject(parseCredentials(sa))).toBe("demo-project");
  expect(defaultProject(parseCredentials(adc))).toBe("quota-proj");
});

test("impersonation keeps the source's project and labels the target", () => {
  const creds = accountCredentials(adc, "viewer@other.iam.gserviceaccount.com");
  expect(credentialsLabel(creds)).toBe("viewer@other.iam.gserviceaccount.com");
  expect(defaultProject(creds)).toBe("quota-proj");
});

test("secret payloads decode without TextDecoder", () => {
  const original = globalThis.TextDecoder;
  // @ts-expect-error simulate Hermes
  delete globalThis.TextDecoder;
  try {
    expect(decodeSecretPayload("v1", "aMOpbGxv").text).toBe("héllo");
    expect(decodeSecretPayload("v1", "/w==").isBinary).toBe(true);
  } finally {
    globalThis.TextDecoder = original;
  }
});
