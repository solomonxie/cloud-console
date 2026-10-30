// The object-storage surface the mobile Buckets screens and the operation
// queue need, implemented for S3 (SigV4) and Tencent COS (COS v5 signing).
// Wider than storage/types.ts StorageClient: adds batch delete, HEAD ETag
// (skip identical uploads) and per-bucket regions.
import type { ListPage } from "./storage/types.ts";

export type StorageService = "s3" | "cos";

export type PutBody = ArrayBuffer | Uint8Array | string | Blob;

export interface ObjectStore {
  readonly service: StorageService;
  listObjects(bucket: string, region: string, prefix: string): Promise<ListPage>;
  listAllKeys(bucket: string, region: string, prefix: string): Promise<string[]>;
  /** Object body as text-or-bytes for preview. */
  download(bucket: string, region: string, key: string): Promise<ArrayBuffer>;
  presignedUrl(bucket: string, region: string, key: string, expiresIn?: number): string;
  deleteObject(bucket: string, region: string, key: string): Promise<void>;
  batchDelete(bucket: string, region: string, keys: string[]): Promise<void>;
  copyObject(opts: { sourceBucket: string; sourceRegion: string; sourceKey: string; destBucket: string; destRegion: string; destKey: string }): Promise<void>;
  putObject(bucket: string, region: string, key: string, body: PutBody, contentType?: string): Promise<void>;
  /** Unquoted ETag, or undefined if missing/unknown (never blocks an upload). */
  headETag(bucket: string, region: string, key: string): Promise<string | undefined>;
}

/** Keys with reserved characters, encoded per path segment. */
export function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");
}

export function batchDeleteXml(keys: string[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return `<Delete><Quiet>true</Quiet>${keys.map((k) => `<Object><Key>${esc(k)}</Key></Object>`).join("")}</Delete>`;
}

/** Last path segment, ignoring a trailing "/". */
export function displayName(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed;
}
