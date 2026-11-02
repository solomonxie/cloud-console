// A Tencent connection's own key: the stored SecretId/SecretKey, nothing else.
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import type { TencentKey } from "@cloud-console/core/tencent/tc3";
import { resourceCache } from "../app/resource-cache.ts";
import { DEFAULT_RESOURCE_TTL } from "@cloud-console/core/cache";

export function tencentKey(conn: StorageConnection): TencentKey {
  return { secretId: conn.accessKeyId ?? "", secretKey: conn.secretAccessKey ?? "" };
}

// Cached listing keyed like the mobile app (`<kind>[@region]:<conn id>`).
export function cached<T>(key: string, fresh: boolean, fetch: () => Promise<T>, ttl = DEFAULT_RESOURCE_TTL): Promise<T> {
  return resourceCache.cached(key, ttl, fresh, fetch);
}

export function favScope(conn: StorageConnection, kind: string): string {
  return `tencent:${conn.id}:${kind}`;
}
