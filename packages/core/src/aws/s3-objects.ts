// S3 object operations (port of S3Client.swift's object calls).
import { md5 } from "@noble/hashes/legacy.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { presignUrl, signRequest, type AwsKey } from "./sigv4.ts";
import { parseQueryError } from "./errors.ts";
import { base64Encode } from "./encoding.ts";
import { parseListObjects } from "../storage/s3.ts";
import { batchDeleteXml, encodeKeyPath, type ObjectStore, type PutBody } from "../object-store.ts";
import type { ListPage } from "../storage/types.ts";

function objectUrl(bucket: string, region: string, key: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeKeyPath(key)}`;
}

export class S3ObjectStore implements ObjectStore {
  readonly service = "s3" as const;
  constructor(private readonly key: AwsKey) {}

  private async send(method: string, url: string, region: string, opts: { body?: PutBody; headers?: Record<string, string>; payloadHash?: string } = {}): Promise<Response> {
    const signable = typeof opts.body === "string" || opts.body instanceof Uint8Array ? opts.body : undefined;
    const headers = signRequest({
      ...this.key,
      method,
      url,
      region,
      service: "s3",
      headers: opts.headers,
      body: signable,
      payloadHash: signable === undefined && opts.body !== undefined ? "UNSIGNED-PAYLOAD" : opts.payloadHash,
    });
    const response = await fetch(url, { method, headers, body: opts.body as BodyInit | undefined });
    if (!response.ok) throw parseQueryError(response.status, await response.text().catch(() => ""));
    return response;
  }

  async listObjects(bucket: string, region: string, prefix: string): Promise<ListPage> {
    const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("delimiter", "/");
    url.searchParams.set("prefix", prefix);
    const page = parseListObjects(await (await this.send("GET", url.toString(), region)).text());
    return { folders: page.folders, objects: page.objects.filter((o) => !o.key.endsWith("/")) };
  }

  async listAllKeys(bucket: string, region: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      if (token) url.searchParams.set("continuation-token", token);
      const page = parseListObjects(await (await this.send("GET", url.toString(), region)).text());
      keys.push(...page.objects.map((o) => o.key));
      token = page.nextToken;
    } while (token);
    return keys;
  }

  async download(bucket: string, region: string, key: string): Promise<ArrayBuffer> {
    return (await this.send("GET", objectUrl(bucket, region, key), region)).arrayBuffer();
  }

  presignedUrl(bucket: string, region: string, key: string, expiresIn = 3600): string {
    return presignUrl({ ...this.key, url: objectUrl(bucket, region, key), region, expiresIn });
  }

  async deleteObject(bucket: string, region: string, key: string): Promise<void> {
    await this.send("DELETE", objectUrl(bucket, region, key), region);
  }

  async batchDelete(bucket: string, region: string, keys: string[]): Promise<void> {
    const body = batchDeleteXml(keys);
    await this.send("POST", `https://${bucket}.s3.${region}.amazonaws.com/?delete`, region, {
      body,
      headers: { "Content-MD5": base64Encode(md5(utf8ToBytes(body))), "Content-Type": "application/xml" },
    });
  }

  async copyObject(o: { sourceBucket: string; sourceRegion: string; sourceKey: string; destBucket: string; destRegion: string; destKey: string }): Promise<void> {
    await this.send("PUT", objectUrl(o.destBucket, o.destRegion, o.destKey), o.destRegion, {
      headers: { "x-amz-copy-source": `/${o.sourceBucket}/${encodeKeyPath(o.sourceKey)}` },
    });
  }

  async putObject(bucket: string, region: string, key: string, body: PutBody, contentType?: string): Promise<void> {
    await this.send("PUT", objectUrl(bucket, region, key), region, {
      body,
      headers: contentType ? { "Content-Type": contentType } : undefined,
    });
  }

  async headETag(bucket: string, region: string, key: string): Promise<string | undefined> {
    try {
      const response = await this.send("HEAD", objectUrl(bucket, region, key), region);
      return response.headers.get("ETag")?.replace(/"/g, "") ?? undefined;
    } catch {
      return undefined;
    }
  }
}
