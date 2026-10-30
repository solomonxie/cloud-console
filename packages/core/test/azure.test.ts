import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildConnectionString, parseConnectionString } from "../src/storage/azure.ts";
import { presignUrl, signRequest } from "../src/storage/azure-sig.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// Azurite's well-known development account; expected signatures were
// computed independently with Node's crypto.createHmac over the same
// string-to-sign.
const { accountName, accountKey } = parseConnectionString(fixture("azure-connection-string.txt").trim());
const now = new Date("2026-10-30T12:00:00Z");

test("parses a portal connection string into account name and key", () => {
  expect(accountName).toBe("devstoreaccount1");
  expect(accountKey).toBe(
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="
  );
});

test("round-trips a connection string", () => {
  expect(parseConnectionString(buildConnectionString(accountName, accountKey))).toEqual({
    accountName,
    accountKey,
  });
});

test("rejects a connection string without AccountKey", () => {
  expect(() => parseConnectionString("DefaultEndpointsProtocol=https;AccountName=x")).toThrow(
    /AccountName and AccountKey/
  );
});

test("signs a List Blobs request with Shared Key", () => {
  const headers = signRequest({
    method: "GET",
    url: "https://devstoreaccount1.blob.core.windows.net/assets?restype=container&comp=list&delimiter=%2F&prefix=docs%2F",
    accountName,
    accountKey,
    now,
  });
  expect(headers["x-ms-date"]).toBe("Fri, 30 Oct 2026 12:00:00 GMT");
  expect(headers["x-ms-version"]).toBe("2021-08-06");
  expect(headers.Authorization).toBe(
    "SharedKey devstoreaccount1:5UM8N+TRZMPB+3e1Vi663RzUUhmEDTbRCyKAFmwoD+o="
  );
});

test("signs a Put Blob with content length, type and x-ms headers", () => {
  const headers = signRequest({
    method: "PUT",
    url: "https://devstoreaccount1.blob.core.windows.net/assets/docs/hello%20world.txt",
    accountName,
    accountKey,
    headers: { "x-ms-blob-type": "BlockBlob", "content-type": "text/plain" },
    contentLength: 11,
    now,
  });
  expect(headers.Authorization).toBe(
    "SharedKey devstoreaccount1:ch5PdgmIuZ4pADd65AMAb+/c9RRrOP/PXMjiv5i5FQ8="
  );
});

test("builds a read-only Service SAS URL", () => {
  const url = new URL(
    presignUrl({
      url: "https://devstoreaccount1.blob.core.windows.net/assets/docs/hello%20world.txt",
      accountName,
      accountKey,
      container: "assets",
      blob: "docs/hello world.txt",
      expiresIn: 3600,
      now,
    })
  );
  expect(url.searchParams.get("se")).toBe("2026-10-30T13:00:00Z");
  expect(url.searchParams.get("sp")).toBe("r");
  expect(url.searchParams.get("sr")).toBe("b");
  expect(url.searchParams.get("sig")).toBe("ZdD4Y1c3N5hdN0VpRyMZOLph6KNo0MZm9Rv28qRihYY=");
});
