import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseListBlobs } from "../src/storage/azure.ts";
import { parseListObjects } from "../src/storage/s3.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("parses an S3 ListObjectsV2 page with folders, objects and a continuation token", () => {
  const page = parseListObjects(fixture("s3-list-objects-v2.xml"));
  expect(page.folders).toEqual(["photos/2025/", "photos/2026/"]);
  expect(page.objects).toEqual([
    { key: "photos/", size: 0, lastModified: "2026-03-01T09:00:00.000Z", storageClass: "STANDARD" },
    { key: "photos/0001.jpg", size: 482133, lastModified: "2026-03-02T10:15:30.000Z", storageClass: "STANDARD_IA" },
    { key: "photos/notes & ideas.md", size: 1024, lastModified: "2026-03-03T18:42:07.000Z", storageClass: "STANDARD" },
  ]);
  expect(page.nextToken).toBe("1w41l63U0xa8q7smH50vCxyTQqdxo69O3EmK28Bi5PcROI4wI/EyIJg==");
});

test("keeps a single S3 object as a list and numeric-looking keys as strings", () => {
  const page = parseListObjects(fixture("s3-list-objects-v2-single.xml"));
  expect(page.folders).toEqual([]);
  expect(page.objects).toEqual([
    { key: "logs/0042", size: 17, lastModified: "2026-04-11T00:00:01.000Z", storageClass: "STANDARD" },
  ]);
  expect(page.nextToken).toBeUndefined();
});

test("parses an empty S3 listing", () => {
  const page = parseListObjects(fixture("s3-list-objects-v2-empty.xml"));
  expect(page).toEqual({ folders: [], objects: [], nextToken: undefined });
});

test("parses an Azure List Blobs page with prefixes, blobs and a next marker", () => {
  const page = parseListBlobs(fixture("azure-list-blobs.xml"));
  expect(page.folders).toEqual(["docs/archive/"]);
  expect(page.objects).toEqual([
    { key: "docs/readme.md", size: 2048, lastModified: "Tue, 03 Mar 2026 11:22:33 GMT" },
    { key: "docs/report 2026 & plan.pdf", size: 734003, lastModified: "Wed, 04 Mar 2026 08:00:00 GMT" },
  ]);
  expect(page.nextToken).toBe("2!88!MDAwMDE5IWRvY3MvcmVwb3J0LnBkZiEwMDAwMjgh");
});

test("treats an empty Azure NextMarker as the last page", () => {
  const page = parseListBlobs(fixture("azure-list-blobs-last-page.xml"));
  expect(page).toEqual({ folders: ["docs/zz/"], objects: [], nextToken: undefined });
});
