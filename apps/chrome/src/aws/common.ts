// What every AWS screen shares: the connection's own key, a session-only
// listing cache (the mobile app's ResourceCache scheme, keyed
// `aws:<kind>[@region]:<connection id>` — never a credential), and the account's enabled regions.
// Only read-only listings are cached — never credentials, parameter values
// or policy documents.
import type { AwsKey } from "@cloud-console/core/aws/sigv4";
import { errorMessage } from "@cloud-console/core/aws/errors";
import { listRegions } from "@cloud-console/core/aws/ec2";
import { enabledRegions } from "@cloud-console/core/aws/regions";
import { DEFAULT_RESOURCE_TTL } from "@cloud-console/core/cache";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { resourceCache } from "../app/resource-cache.ts";

export function awsKey(conn: StorageConnection): AwsKey {
  return { accessKeyId: conn.accessKeyId ?? "", secretAccessKey: conn.secretAccessKey ?? "" };
}

// The shared session cache (app/resource-cache.ts).
export const awsCache = resourceCache;

export function cacheKey(kind: string, conn: StorageConnection, region?: string): string {
  return `aws:${kind}${region ? `@${region}` : ""}:${conn.id}`;
}

export function cached<T>(key: string, fetch: () => Promise<T>, opts: { ttl?: number; force?: boolean } = {}): Promise<T> {
  return awsCache.cached(key, opts.ttl ?? DEFAULT_RESOURCE_TTL, opts.force ?? false, fetch);
}

// DescribeRegions (cached a day); the default set when it isn't allowed.
export async function awsRegions(conn: StorageConnection, force = false): Promise<string[]> {
  let listed: string[] | undefined;
  try {
    listed = await cached(cacheKey("aws-regions", conn), () => listRegions(awsKey(conn)), { ttl: 86_400_000, force });
  } catch {
    listed = undefined;
  }
  return enabledRegions(listed);
}

export function describe(err: unknown, what: string): string {
  return `${what}: ${errorMessage(err)}`;
}
