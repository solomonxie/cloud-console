import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  exportConnections,
  normalizeEndpoint,
  normalizePrefix,
  parseImport,
  regionForEndpoint,
} from "../src/storage/connection.ts";
import { bytesToBase64, base64ToBytes } from "../src/util/base64.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("imports an export file written by the old extension", () => {
  const conns = parseImport(fixture("connections-export.json"));
  expect(conns.map((c) => [c.type, c.bucket, c.prefix])).toEqual([
    ["s3", "example-bucket", "photos/"],
    ["gcs", "my-gcs-bucket", ""],
  ]);
  expect(JSON.parse(conns[1].serviceAccountJson ?? "").type).toBe("authorized_user");
  expect(parseImport(exportConnections(conns))).toEqual(conns);
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
