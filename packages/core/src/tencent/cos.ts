// Tencent COS — S3-shaped REST API signed with COS v5 (port of TencentCOSClient.swift).
import { md5 } from "@noble/hashes/legacy.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { cosHeaders, cosPresignedUrl } from "./cos-sign.ts";
import type { TencentKey } from "./tc3.ts";
import { parseQueryError } from "../aws/errors.ts";
import { base64Encode } from "../aws/encoding.ts";
import { parseListAllMyBuckets, type Bucket } from "../aws/s3-buckets.ts";
import { parseListObjects } from "../storage/s3.ts";
import { batchDeleteXml, encodeKeyPath, type ObjectStore, type PutBody } from "../object-store.ts";
import type { ListPage } from "../storage/types.ts";

function host(bucket: string, region: string): string {
  return `${bucket}.cos.${region}.myqcloud.com`;
}

function objectUrl(bucket: string, region: string, key: string): string {
  return `https://${host(bucket, region)}/${encodeKeyPath(key)}`;
}

export class COSObjectStore implements ObjectStore {
  readonly service = "cos" as const;
  constructor(private readonly key: TencentKey) {}

  private async send(method: string, url: string, opts: { body?: PutBody; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers = cosHeaders({ ...this.key, method, url, headers: opts.headers });
    const response = await fetch(url, { method, headers, body: opts.body as BodyInit | undefined });
    if (!response.ok) throw parseQueryError(response.status, await response.text().catch(() => ""));
    return response;
  }

  async listBuckets(): Promise<Bucket[]> {
    const text = await (await this.send("GET", "https://service.cos.myqcloud.com/")).text();
    return parseListAllMyBuckets(text).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async listObjects(bucket: string, region: string, prefix: string): Promise<ListPage> {
    const url = new URL(`https://${host(bucket, region)}/`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("delimiter", "/");
    url.searchParams.set("prefix", prefix);
    const page = parseListObjects(await (await this.send("GET", url.toString())).text());
    return { folders: page.folders, objects: page.objects.filter((o) => !o.key.endsWith("/")) };
  }

  async listAllKeys(bucket: string, region: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const url = new URL(`https://${host(bucket, region)}/`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      if (token) url.searchParams.set("continuation-token", token);
      const page = parseListObjects(await (await this.send("GET", url.toString())).text());
      keys.push(...page.objects.map((o) => o.key));
      token = page.nextToken;
    } while (token);
    return keys;
  }

  async download(bucket: string, region: string, key: string): Promise<ArrayBuffer> {
    return (await this.send("GET", objectUrl(bucket, region, key))).arrayBuffer();
  }

  presignedUrl(bucket: string, region: string, key: string, expiresIn = 3600): string {
    return cosPresignedUrl({ ...this.key, method: "GET", url: objectUrl(bucket, region, key), expiresIn });
  }

  async deleteObject(bucket: string, region: string, key: string): Promise<void> {
    await this.send("DELETE", objectUrl(bucket, region, key));
  }

  async batchDelete(bucket: string, region: string, keys: string[]): Promise<void> {
    const body = batchDeleteXml(keys);
    await this.send("POST", `https://${host(bucket, region)}/?delete`, {
      body,
      headers: { "Content-MD5": base64Encode(md5(utf8ToBytes(body))), "Content-Type": "application/xml" },
    });
  }

  async copyObject(o: { sourceBucket: string; sourceRegion: string; sourceKey: string; destBucket: string; destRegion: string; destKey: string }): Promise<void> {
    await this.send("PUT", objectUrl(o.destBucket, o.destRegion, o.destKey), {
      headers: { "x-cos-copy-source": `${host(o.sourceBucket, o.sourceRegion)}/${encodeKeyPath(o.sourceKey)}` },
    });
  }

  async putObject(bucket: string, region: string, key: string, body: PutBody, contentType?: string): Promise<void> {
    await this.send("PUT", objectUrl(bucket, region, key), { body, headers: contentType ? { "Content-Type": contentType } : undefined });
  }

  async headETag(bucket: string, region: string, key: string): Promise<string | undefined> {
    try {
      const response = await this.send("HEAD", objectUrl(bucket, region, key));
      return response.headers.get("ETag")?.replace(/"/g, "") ?? undefined;
    } catch {
      return undefined;
    }
  }
}
