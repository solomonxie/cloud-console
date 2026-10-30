// Recursive prefix operations shared by every client, built on the
// client's own listAllKeys/deleteObject/copyObject — one object at a time.
import type { Progress, StorageClient } from "./types.ts";

type Ops = Pick<StorageClient, "listAllKeys" | "deleteObject" | "copyObject">;

export async function deletePrefix(
  client: Ops,
  bucket: string,
  prefix: string,
  onProgress?: Progress
): Promise<number> {
  let count = 0;
  for await (const key of client.listAllKeys(bucket, prefix)) {
    await client.deleteObject(bucket, key);
    count += 1;
    onProgress?.(count);
  }
  return count;
}

// Walks every key under sourcePrefix and copies it to the same relative
// path under destPrefix.
export async function copyPrefix(
  client: Ops,
  bucket: string,
  destPrefix: string,
  sourceBucket: string,
  sourcePrefix: string,
  onProgress?: Progress
): Promise<number> {
  let count = 0;
  for await (const key of client.listAllKeys(sourceBucket, sourcePrefix)) {
    const destKey = destPrefix + key.slice(sourcePrefix.length);
    await client.copyObject(bucket, destKey, sourceBucket, key);
    count += 1;
    onProgress?.(count);
  }
  return count;
}

export function folderKey(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function setQuery(url: URL, query: Record<string, string | undefined>): URL {
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  return url;
}
