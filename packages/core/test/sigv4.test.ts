import { expect, test } from "vitest";
import { presignUrl, signRequest } from "../src/aws/sigv4.ts";

// Example key and expected signatures from AWS's S3 SigV4 documentation.
const key = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const now = new Date("2013-05-24T00:00:00Z");

test("signs an S3 GET object request", () => {
  const headers = signRequest({
    ...key,
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    region: "us-east-1",
    service: "s3",
    headers: { Range: "bytes=0-9" },
    now,
  });
  expect(headers.Authorization).toContain(
    "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date"
  );
  expect(headers.Authorization).toContain(
    "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
  );
});

test("presigns an S3 GET object URL", () => {
  const url = presignUrl({
    ...key,
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    region: "us-east-1",
    expiresIn: 86400,
    now,
  });
  expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe(
    "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
  );
});
