import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  bucketConnection,
  connectionLabel,
  exportConnections,
  normalizeEndpoint,
  normalizePrefix,
  parseImport,
  regionForEndpoint,
  storageTypeForVendor,
  withStorageScope,
} from "../src/storage/connection.ts";
import { bytesToBase64, base64ToBytes } from "../src/util/base64.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("imports an export file written by the old extension as bucket-scoped connections", () => {
  const conns = parseImport(fixture("connections-export.json"));
  expect(conns.map((c) => [c.type, c.bucket, c.prefix, c.storageScope])).toEqual([
    ["s3", undefined, undefined, { bucket: "example-bucket", prefix: "photos/" }],
    ["gcs", undefined, undefined, { bucket: "my-gcs-bucket" }],
  ]);
  expect(conns[0].region).toBe("eu-west-1");
  expect(JSON.parse(conns[1].serviceAccountJson ?? "").type).toBe("authorized_user");
  expect(parseImport(exportConnections(conns))).toEqual(conns);
});

test("imports vendor-level connections unchanged", () => {
  const raw = JSON.parse(fixture("storage/connections-export-v2.json")).connections;
  const conns = parseImport(fixture("storage/connections-export-v2.json"));
  expect(conns).toEqual(raw);
  expect(conns.map(withStorageScope)).toEqual(raw);
  expect(conns.map((c) => [c.resources, c.storageScope])).toEqual([
    [["s3"], undefined],
    [undefined, { bucket: "media-sh", prefix: "public/" }],
  ]);
});

test("builds the per-bucket connection the browser opens", () => {
  const [aws, oss] = parseImport(fixture("storage/connections-export-v2.json"));
  const synthetic = bucketConnection(aws, "alpha-photos", { region: "eu-west-1" });
  expect([synthetic.bucket, synthetic.prefix, synthetic.region, synthetic.accessKeyId]).toEqual(["alpha-photos", "", "eu-west-1", aws.accessKeyId]);
  expect(aws.bucket).toBeUndefined();
  expect(bucketConnection(oss, "media-sh", { prefix: "public/" }).region).toBe("cn-shanghai");
});

test("labels never need a bucket", () => {
  const [aws, oss] = parseImport(fixture("storage/connections-export-v2.json"));
  expect(connectionLabel({ ...aws, name: "" })).toBe("AWS S3");
  expect(connectionLabel({ ...oss, name: "" })).toBe("media-sh");
  expect(storageTypeForVendor("s3compat")).toBe("s3-compat");
  expect(storageTypeForVendor("tencent")).toBe("tencent-cos");
});

test("rejects a file without a connections array", () => {
  expect(() => parseImport('{"version":1}')).toThrow(/connections/);
});

test("normalizes prefixes and endpoints", () => {
  expect(normalizePrefix("/logs/2026")).toBe("logs/2026/");
  expect(normalizePrefix("")).toBe("");
  expect(normalizeEndpoint(" https://abc.r2.cloudflarestorage.com/bucket ")).toBe("abc.r2.cloudflarestorage.com");
  expect(regionForEndpoint("abc.r2.cloudflarestorage.com")).toBe("auto");
  expect(regionForEndpoint("minio.example.com")).toBe("us-east-1");
});

test("base64 round-trips arbitrary bytes", () => {
  const key = fixture("azure-connection-string.txt").match(/AccountKey=([^;]+)/)?.[1] ?? "";
  expect(bytesToBase64(base64ToBytes(key))).toBe(key);
  expect(bytesToBase64(new Uint8Array([1, 2]))).toBe("AQI=");
  expect(bytesToBase64(new Uint8Array([1]))).toBe("AQ==");
});
