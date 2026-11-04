/// <reference types="node" />
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { clearTokenCache, type ServiceAccountKey } from "../src/gcp/auth.ts";
import { GcsObjectStore } from "../src/gcp/gcs-objects.ts";
import { DemoCloud } from "../src/demo/cloud.ts";
import { apiCalls, fixtureJson, mockFetch } from "./gcp-helpers.ts";

const sa = fixtureJson<ServiceAccountKey>("service-account.json");

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokenCache();
});

test("GcsObjectStore lists a folder across pages", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/storage/v1/b/media/o" ? { fixture: url.searchParams.get("pageToken") === "p2" ? "gcs-list-page2.json" : "gcs-list-page1.json" } : undefined
  );
  const page = await new GcsObjectStore(sa).listObjects("media", "", "");
  expect(page.folders).toEqual(["covers/"]);
  expect(page.objects.map((o) => [o.key, o.size])).toEqual([["feed.xml", 48210], ["notes.txt", 12]]);
  expect(apiCalls(calls)).toHaveLength(2);
});

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

test("the GCP demo fixture answers mobile cache keys", () => {
  const demo = new DemoCloud({ connections: [], aws: {}, tencent: {}, gcp: read("../../demo/gcp.json") });
  expect(demo.value<{ name: string }[]>("gce-instances:gcp:fernhill-prod").map((i) => i.name)).toContain("api-1");
  expect(demo.value<string>("gcp-secret-value@smtp-password:gcp")).toMatch(/demo/);
  expect(demo.buckets("gcp").map((b) => b.name)).toEqual(["fernhill-backups", "fernhill-media"]);
  expect(demo.objects("gcp", "fernhill-media", "covers/").objects).toHaveLength(2);
});
