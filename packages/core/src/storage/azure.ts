// Container-scoped client for Azure Blob Storage, mirroring S3Client's
// method surface. Auth is a storage account name + Shared Key — no OAuth/AD
// sign-in, matching how S3 access keys work.
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { presignUrl, signRequest } from "./azure-sig.ts";
import type { StorageConnection } from "./connection.ts";
import type { Body, ListPage, Progress, StorageClient } from "./types.ts";
import { copyPrefix, deletePrefix, folderKey, setQuery } from "./walk.ts";
import { child, children, errorFromXml, parseXml, text, type XmlNode } from "./xml.ts";

const PAGE_SIZE = 100;

// "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
// — the connection-string shape Azure's own portal and SDKs hand out, so
// the connection form asks for this one string instead of two fields.
export function parseConnectionString(str: string): { accountName: string; accountKey: string } {
  const parts: Record<string, string> = {};
  for (const segment of str.split(";")) {
    const idx = segment.indexOf("=");
    if (idx < 0) continue;
    parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
  }
  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error("Invalid connection string: expected AccountName and AccountKey");
  }
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

export function buildConnectionString(accountName: string, accountKey: string): string {
  return `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
}

function bodyLength(body: Body | undefined): number {
  if (!body) return 0;
  if (typeof body === "string") return utf8ToBytes(body).length;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  return 0;
}

export function parseListBlobs(xml: string): ListPage {
  const doc = parseXml(xml, ["Blob", "BlobPrefix"]);
  const root = doc.EnumerationResults as XmlNode | undefined;
  const blobs = child(root, "Blobs");
  const folders = children(blobs, "BlobPrefix").map((p) => text(p, "Name"));
  const objects = children(blobs, "Blob").map((b) => {
    const props = child(b, "Properties");
    return {
      key: text(b, "Name"),
      size: Number(text(props, "Content-Length") || 0),
      lastModified: text(props, "Last-Modified") || undefined,
    };
  });
  const next = text(root, "NextMarker");
  return { folders, objects, nextToken: next || undefined };
}

interface RequestOpts {
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: Body;
  contentLength?: number;
}

export class AzureClient implements StorageClient {
  readonly scheme = "az";
  readonly canPresign = true;

  // accessKeyId = account name, secretAccessKey = account key
  constructor(private readonly conn: StorageConnection) {}

  private get account(): string {
    return this.conn.accessKeyId ?? "";
  }

  private host(): string {
    return `${this.account}.blob.core.windows.net`;
  }

  urlFor(container: string, blob = "", query: Record<string, string | undefined> = {}): URL {
    const path = container ? `/${container}/${blob}` : "/";
    return setQuery(new URL(`https://${this.host()}${path}`), query);
  }

  private async request(method: string, container: string, blob: string, opts: RequestOpts = {}): Promise<Response> {
    const url = this.urlFor(container, blob, opts.query).toString();
    const headers = signRequest({
      method,
      url,
      accountName: this.account,
      accountKey: this.conn.secretAccessKey ?? "",
      headers: opts.headers,
      contentLength: opts.contentLength,
    });
    const resp = await fetch(url, { method, headers, body: opts.body as BodyInit | undefined });
    if (!resp.ok) {
      const respBody = await resp.text().catch(() => "");
      const { code, message } = errorFromXml(respBody);
      throw new Error(
        code && message ? `${code}: ${message}` : `Azure ${method} ${resp.status} ${resp.statusText}`
      );
    }
    return resp;
  }

  async listObjects(bucket: string, prefix: string, token?: string): Promise<ListPage> {
    const resp = await this.request("GET", bucket, "", {
      query: {
        restype: "container",
        comp: "list",
        delimiter: "/",
        prefix,
        maxresults: String(PAGE_SIZE),
        marker: token || undefined,
      },
    });
    return parseListBlobs(await resp.text());
  }

  async *listAllKeys(bucket: string, prefix: string): AsyncIterable<string> {
    let marker: string | undefined;
    do {
      const resp = await this.request("GET", bucket, "", {
        query: { restype: "container", comp: "list", prefix, marker },
      });
      const page = parseListBlobs(await resp.text());
      for (const obj of page.objects) yield obj.key;
      marker = page.nextToken;
    } while (marker);
  }

  async getObjectBlob(bucket: string, key: string): Promise<Blob> {
    return (await this.request("GET", bucket, key)).blob();
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.request("DELETE", bucket, key);
  }

  deletePrefix(bucket: string, prefix: string, onProgress?: Progress): Promise<number> {
    return deletePrefix(this, bucket, prefix, onProgress);
  }

  // Server-side "Copy Blob" — same storage account only (the destination
  // request's Shared Key auth doesn't grant read access to a source in a
  // different account; that would need a source SAS, not implemented here,
  // matching the same-connection clipboard model). Copy is async: poll the
  // destination's x-ms-copy-status until it settles.
  async copyObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void> {
    const sourceUrl = this.urlFor(sourceBucket, sourceKey).toString();
    await this.request("PUT", bucket, key, { headers: { "x-ms-copy-source": sourceUrl } });
    await this.waitForCopy(bucket, key);
  }

  private async waitForCopy(bucket: string, key: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await this.request("HEAD", bucket, key);
      const status = resp.headers.get("x-ms-copy-status");
      if (!status || status === "success") return;
      if (status === "failed" || status === "aborted") throw new Error(`Copy ${status}`);
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("Copy timed out");
  }

  async moveObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void> {
    await this.copyObject(bucket, key, sourceBucket, sourceKey);
    await this.deleteObject(sourceBucket, sourceKey);
  }

  copyPrefix(bucket: string, destPrefix: string, sourceBucket: string, sourcePrefix: string, onProgress?: Progress): Promise<number> {
    return copyPrefix(this, bucket, destPrefix, sourceBucket, sourcePrefix, onProgress);
  }

  async putObject(bucket: string, key: string, body: Body, contentType?: string): Promise<void> {
    const headers: Record<string, string> = { "x-ms-blob-type": "BlockBlob" };
    if (contentType) headers["content-type"] = contentType;
    await this.request("PUT", bucket, key, { headers, body, contentLength: bodyLength(body) });
  }

  async createFolder(bucket: string, prefix: string): Promise<void> {
    await this.putObject(bucket, folderKey(prefix), new Uint8Array(0));
  }

  // Share links: an az:// URI, an unsigned HTTP URL (only useful on a public
  // container/blob), and a time-limited SAS-signed URL.
  resourceUri(bucket: string, key: string): string {
    return `az://${this.account}/${bucket}/${key}`;
  }

  unsignedUrl(bucket: string, key: string): string {
    return this.urlFor(bucket, key).toString();
  }

  async presignedUrl(bucket: string, key: string, expiresIn = 3600): Promise<string> {
    return presignUrl({
      url: this.urlFor(bucket, key).toString(),
      accountName: this.account,
      accountKey: this.conn.secretAccessKey ?? "",
      container: bucket,
      blob: key,
      expiresIn,
    });
  }
}
