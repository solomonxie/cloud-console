/// <reference types="node" />
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { parseListAllMyBuckets } from "../src/aws/s3-buckets.ts";
import { azureListUrl, listBuckets, ossRegion, parseListContainers, serviceUrl } from "../src/storage/buckets.ts";
import type { StorageConnection } from "../src/storage/connection.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/storage/${name}`, import.meta.url), "utf8");
const azureKey = readFileSync(new URL("./fixtures/azure-connection-string.txt", import.meta.url), "utf8").match(/AccountKey=([^;\s]+)/)?.[1] ?? "";

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
}

// Answers each request with the routed fixture (and response headers).
function mockFetch(route: (call: Call) => { fixture?: string; headers?: Record<string, string> } | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = { url: new URL(input), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string> };
      calls.push(call);
      const hit = route(call);
      if (!hit) return new Response(`no route for ${call.method} ${call.url}`, { status: 599 });
      return new Response(hit.fixture ? fixture(hit.fixture) : null, { status: 200, headers: hit.headers });
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const conn = (c: Partial<StorageConnection> & Pick<StorageConnection, "type">): StorageConnection => ({
  id: "test",
  name: "test",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  ...c,
});

test("parses Azure List Containers with a next marker", () => {
  const page = parseListContainers(fixture("azure-list-containers.xml"));
  expect(page).toEqual({
    buckets: [
      { name: "backups", creationDate: "2026-03-03T09:12:44.000Z" },
      { name: "0001", creationDate: "2026-04-15T18:00:00.000Z" },
    ],
    nextMarker: "/exampleaccount/photos",
  });
  expect(parseListContainers(fixture("azure-list-containers-last-page.xml")).nextMarker).toBeUndefined();
});

test("builds the Azure list URL for an account", () => {
  expect(azureListUrl("exampleaccount")).toBe("https://exampleaccount.blob.core.windows.net/?comp=list");
  expect(azureListUrl("exampleaccount", "/exampleaccount/photos")).toBe(
    "https://exampleaccount.blob.core.windows.net/?comp=list&marker=%2Fexampleaccount%2Fphotos"
  );
});

test("parses OSS and COS bucket lists with their locations", () => {
  expect(parseListAllMyBuckets(fixture("oss-list-all-my-buckets.xml"))).toEqual([
    { name: "media-sh", creationDate: "2026-02-10T08:15:22.000Z", region: "oss-cn-shanghai" },
    { name: "archive-hz", creationDate: "2025-11-01T02:00:00.000Z", region: "oss-cn-hangzhou" },
  ]);
  expect(parseListAllMyBuckets(fixture("cos-list-all-my-buckets.xml")).map((b) => [b.name, b.region])).toEqual([
    ["logs-1250000000", "ap-guangzhou"],
    ["assets-1250000000", "ap-singapore"],
  ]);
  expect(ossRegion("oss-cn-shanghai")).toBe("cn-shanghai");
  expect(ossRegion("cn-shanghai")).toBe("cn-shanghai");
});

test("service endpoints for S3-compatible and OSS", () => {
  expect(serviceUrl(conn({ type: "s3-compat", endpoint: "abc.r2.cloudflarestorage.com" }))).toEqual({
    url: "https://abc.r2.cloudflarestorage.com/",
    region: "auto",
  });
  expect(serviceUrl(conn({ type: "s3-compat", endpoint: "minio.example.com" })).region).toBe("us-east-1");
  expect(serviceUrl(conn({ type: "alibaba-oss", region: "cn-shanghai" }))).toEqual({
    url: "https://s3.oss-cn-shanghai.aliyuncs.com/",
    region: "cn-shanghai",
  });
});

test("lists R2 buckets on the account endpoint, signed for region auto", async () => {
  const calls = mockFetch(({ url }) => (url.host === "abc.r2.cloudflarestorage.com" && url.pathname === "/" ? { fixture: "r2-list-all-my-buckets.xml" } : undefined));
  const buckets = await listBuckets(conn({ type: "s3-compat", endpoint: "abc.r2.cloudflarestorage.com", region: "auto" }));
  expect(buckets.map((b) => b.name)).toEqual(["backups", "site-assets"]);
  expect(calls).toHaveLength(1);
  expect(calls[0].headers.Authorization ?? calls[0].headers.authorization).toMatch(/\/auto\/s3\/aws4_request/);
});

test("lists OSS buckets across regions with bare region names", async () => {
  const calls = mockFetch(({ url }) => (url.host === "s3.oss-cn-hangzhou.aliyuncs.com" ? { fixture: "oss-list-all-my-buckets.xml" } : undefined));
  const buckets = await listBuckets(conn({ type: "alibaba-oss", region: "cn-hangzhou" }));
  expect(buckets.map((b) => [b.name, b.region])).toEqual([
    ["archive-hz", "cn-hangzhou"],
    ["media-sh", "cn-shanghai"],
  ]);
  expect(calls).toHaveLength(1);
});

test("lists COS buckets on service.cos.myqcloud.com with COS v5 signing", async () => {
  const calls = mockFetch(({ url }) => (url.host === "service.cos.myqcloud.com" ? { fixture: "cos-list-all-my-buckets.xml" } : undefined));
  const buckets = await listBuckets(conn({ type: "tencent-cos", region: "ap-guangzhou" }));
  expect(buckets.map((b) => [b.name, b.region])).toEqual([
    ["assets-1250000000", "ap-singapore"],
    ["logs-1250000000", "ap-guangzhou"],
  ]);
  expect(calls[0].headers.Authorization).toMatch(/^q-sign-algorithm=sha1&q-ak=AKIDEXAMPLE&/);
});

test("lists Azure containers across pages with Shared Key", async () => {
  const calls = mockFetch(({ url }) => {
    if (url.host !== "exampleaccount.blob.core.windows.net" || url.searchParams.get("comp") !== "list") return undefined;
    return { fixture: url.searchParams.get("marker") ? "azure-list-containers-last-page.xml" : "azure-list-containers.xml" };
  });
  const buckets = await listBuckets(conn({ type: "azure", accessKeyId: "exampleaccount", secretAccessKey: azureKey }));
  expect(buckets.map((b) => b.name)).toEqual(["0001", "backups", "photos"]);
  expect(calls).toHaveLength(2);
  expect(calls[0].headers.Authorization).toMatch(/^SharedKey exampleaccount:/);
});

test("lists AWS buckets globally, each with its own region", async () => {
  const regions: Record<string, string> = { "alpha-photos.s3.amazonaws.com": "eu-west-1", "zeta-logs.s3.amazonaws.com": "us-west-2" };
  const calls = mockFetch(({ url, method }) => {
    if (url.host === "s3.amazonaws.com" && method === "GET") return { fixture: "s3-list-all-my-buckets.xml" };
    if (method === "HEAD" && regions[url.host]) return { headers: { "x-amz-bucket-region": regions[url.host] } };
    return undefined;
  });
  const buckets = await listBuckets(conn({ type: "s3" }));
  expect(buckets.map((b) => [b.name, b.region])).toEqual([
    ["alpha-photos", "eu-west-1"],
    ["zeta-logs", "us-west-2"],
  ]);
  expect(calls).toHaveLength(3);
});
