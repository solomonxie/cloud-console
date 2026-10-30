// S3-dialect REST client: Amazon S3, S3-compatible services (R2, MinIO, …),
// and Tencent COS / Alibaba OSS through their documented S3-compatible
// endpoints. SigV4 via aws/sigv4.ts; XML via fast-xml-parser.
import { presignUrl, signRequest } from "../aws/sigv4.ts";
import type { StorageConnection } from "./connection.ts";
import type { Body, ListPage, Progress, StorageClient } from "./types.ts";
import { copyPrefix, deletePrefix, folderKey, setQuery } from "./walk.ts";
import { children, errorFromXml, parseXml, text, type XmlNode } from "./xml.ts";

const PAGE_SIZE = 100;

// Bucket region isn't derivable from its name, but S3's legacy global
// endpoint reports it in a response header even on an unauthenticated,
// unsigned request — so we can look it up before the user supplies a region.
export async function detectBucketRegion(bucket: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://${bucket}.s3.amazonaws.com/`, { method: "HEAD" });
    return resp.headers.get("x-amz-bucket-region") || null;
  } catch {
    return null;
  }
}

export function parseListObjects(xml: string): ListPage {
  const doc = parseXml(xml, ["Contents", "CommonPrefixes"]);
  const root = doc.ListBucketResult as XmlNode | undefined;
  const folders = children(root, "CommonPrefixes").map((p) => text(p, "Prefix"));
  const objects = children(root, "Contents").map((c) => ({
    key: text(c, "Key"),
    size: Number(text(c, "Size") || 0),
    lastModified: text(c, "LastModified") || undefined,
    storageClass: text(c, "StorageClass") || undefined,
  }));
  const truncated = text(root, "IsTruncated") === "true";
  const next = text(root, "NextContinuationToken");
  return { folders, objects, nextToken: truncated && next ? next : undefined };
}

interface RequestOpts {
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: Body;
  payloadHash?: string;
}

export class S3Client implements StorageClient {
  readonly canPresign = true;

  constructor(private readonly conn: StorageConnection) {}

  get scheme(): string {
    if (this.conn.type === "tencent-cos") return "cos";
    if (this.conn.type === "alibaba-oss") return "oss";
    return "s3";
  }

  private get region(): string {
    return this.conn.region || "us-east-1";
  }

  private usesPathStyle(): boolean {
    return !!this.conn.pathStyle || !!this.conn.endpoint;
  }

  private host(): string {
    if (this.conn.endpoint) return this.conn.endpoint;
    // Tencent COS and Alibaba OSS speak the same S3 dialect through their own
    // documented S3-compatible endpoints, virtual-hosted style (bucket goes
    // in the subdomain, same as AWS) — just a different host.
    if (this.conn.type === "tencent-cos") return `cos.${this.region}.myqcloud.com`;
    if (this.conn.type === "alibaba-oss") return `s3.oss-${this.region}.aliyuncs.com`;
    return `s3.${this.region}.amazonaws.com`;
  }

  urlFor(bucket: string, key = "", query: Record<string, string | undefined> = {}): URL {
    const pathStyle = this.usesPathStyle();
    const host = !pathStyle && bucket ? `${bucket}.${this.host()}` : this.host();
    const path = pathStyle ? (bucket ? `/${bucket}/${key}` : "/") : `/${key}`;
    return setQuery(new URL(`https://${host}${path}`), query);
  }

  private async request(method: string, bucket: string, key: string, opts: RequestOpts = {}): Promise<Response> {
    const url = this.urlFor(bucket, key, opts.query).toString();
    const headers = signRequest({
      method,
      url,
      region: this.region,
      service: "s3",
      accessKeyId: this.conn.accessKeyId ?? "",
      secretAccessKey: this.conn.secretAccessKey ?? "",
      headers: opts.headers,
      payloadHash: opts.payloadHash,
    });
    const resp = await fetch(url, { method, headers, body: opts.body as BodyInit | undefined });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const { code, message } = errorFromXml(body);
      throw new Error(
        code && message ? `${code}: ${message}` : `S3 ${method} ${resp.status} ${resp.statusText}`
      );
    }
    return resp;
  }

  async listObjects(bucket: string, prefix: string, token?: string): Promise<ListPage> {
    const resp = await this.request("GET", bucket, "", {
      query: {
        "list-type": "2",
        delimiter: "/",
        prefix,
        "max-keys": String(PAGE_SIZE),
        "continuation-token": token || undefined,
      },
    });
    return parseListObjects(await resp.text());
  }

  // Non-delimited listing: every key under a prefix (recursive delete/copy).
  async *listAllKeys(bucket: string, prefix: string): AsyncIterable<string> {
    let token: string | undefined;
    do {
      const resp = await this.request("GET", bucket, "", {
        query: { "list-type": "2", prefix, "continuation-token": token },
      });
      const page = parseListObjects(await resp.text());
      for (const obj of page.objects) yield obj.key;
      token = page.nextToken;
    } while (token);
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

  async copyObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void> {
    const copySource = `/${sourceBucket}/${sourceKey}`.split("/").map(encodeURIComponent).join("/");
    await this.request("PUT", bucket, key, { headers: { "x-amz-copy-source": copySource } });
  }

  async moveObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void> {
    await this.copyObject(bucket, key, sourceBucket, sourceKey);
    await this.deleteObject(sourceBucket, sourceKey);
  }

  copyPrefix(bucket: string, destPrefix: string, sourceBucket: string, sourcePrefix: string, onProgress?: Progress): Promise<number> {
    return copyPrefix(this, bucket, destPrefix, sourceBucket, sourcePrefix, onProgress);
  }

  async putObject(bucket: string, key: string, body: Body, contentType?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = contentType;
    await this.request("PUT", bucket, key, { headers, body, payloadHash: "UNSIGNED-PAYLOAD" });
  }

  async createFolder(bucket: string, prefix: string): Promise<void> {
    await this.putObject(bucket, folderKey(prefix), new Uint8Array(0));
  }

  // Share links: a provider URI, an unsigned HTTP URL (only useful on a public
  // bucket/object), and a time-limited SigV4-presigned URL.
  resourceUri(bucket: string, key: string): string {
    return `${this.scheme}://${bucket}/${key}`;
  }

  unsignedUrl(bucket: string, key: string): string {
    return this.urlFor(bucket, key).toString();
  }

  async presignedUrl(bucket: string, key: string, expiresIn = 3600): Promise<string> {
    return presignUrl({
      method: "GET",
      url: this.urlFor(bucket, key).toString(),
      region: this.region,
      accessKeyId: this.conn.accessKeyId ?? "",
      secretAccessKey: this.conn.secretAccessKey ?? "",
      expiresIn,
    });
  }
}
