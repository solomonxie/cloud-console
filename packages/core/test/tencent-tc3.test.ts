import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { tc3Headers, tc3Sign } from "../src/tencent/tc3.ts";

const doc = JSON.parse(
  readFileSync(new URL("./fixtures/tencent/tc3-describe-instances.json", import.meta.url), "utf8")
);

const input = {
  secretId: doc.secretId,
  secretKey: doc.secretKey,
  host: doc.host,
  service: doc.service,
  action: doc.action,
  version: doc.version,
  region: doc.region,
  payload: doc.payload,
  now: new Date(doc.timestamp * 1000),
};

test("matches Tencent's documented TC3 example", () => {
  const signed = tc3Sign({ ...input, signAction: false });
  expect(signed.canonicalRequest).toBe(doc.expectedCanonicalRequest);
  expect(signed.stringToSign).toBe(doc.expectedStringToSign);
  expect(signed.authorization).toBe(doc.expectedAuthorization);
});

test("signs x-tc-action by default, like the Swift app", () => {
  const signed = tc3Sign(input);
  expect(signed.canonicalRequest).toContain("\nx-tc-action:describeinstances\n");
  expect(signed.authorization).toContain("SignedHeaders=content-type;host;x-tc-action, Signature=");
  expect(signed.signature).not.toBe(doc.expectedAuthorization.split("Signature=")[1]);
});

test("returns the X-TC headers a request needs", () => {
  const headers = tc3Headers({ ...input, token: "session-token" });
  expect(headers["X-TC-Action"]).toBe("DescribeInstances");
  expect(headers["X-TC-Timestamp"]).toBe("1551113065");
  expect(headers["X-TC-Version"]).toBe("2017-03-12");
  expect(headers["X-TC-Region"]).toBe("ap-guangzhou");
  expect(headers["X-TC-Token"]).toBe("session-token");
});
