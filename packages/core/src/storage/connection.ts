// A saved storage connection — exactly the shape the Chrome extension has
// always kept in chrome.storage.local and written to export files, so
// existing saved connections and exports keep loading. Field meaning by type:
// - s3 / tencent-cos / alibaba-oss: accessKeyId + secretAccessKey + region
// - s3-compat: same, plus endpoint (host only); region derived from it
// - azure: accessKeyId = storage account name, secretAccessKey = account key
// - gcs: serviceAccountJson = the raw credentials JSON (service account key
//   or gcloud authorized_user ADC — named for the original shape)
//
// A saved connection is vendor-level: a key and the resource kinds it shows,
// its buckets listed from the account (storage/buckets.ts). `bucket`/`prefix`
// are only set on the synthetic, never-saved connection handed to the bucket
// browser for one bucket. Connections saved before that carry a top-level
// bucket(+prefix); withStorageScope() reads those as a storageScope.
import type { ResourceKindId, VendorId } from "../catalog.ts";
import type { StorageType } from "./types.ts";

// Optional "limit to": one bucket, and within it one prefix (the hard root
// of browsing). A prefix only means something with a bucket.
export interface StorageScope {
  bucket?: string;
  prefix?: string;
}

export interface StorageConnection {
  id: string;
  type: StorageType;
  name: string;
  // Resource kinds shown for this connection; absent = all implemented.
  resources?: ResourceKindId[];
  storageScope?: StorageScope;
  // Synthetic per-bucket connections only (and legacy saved ones).
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  endpoint?: string;
  pathStyle?: boolean;
  serviceAccountJson?: string;
}

export interface ConnectionsExport {
  version: 1;
  connections: StorageConnection[];
}

export function exportConnections(connections: StorageConnection[]): string {
  const data: ConnectionsExport = { version: 1, connections };
  return JSON.stringify(data, null, 2);
}

export function parseImport(json: string): StorageConnection[] {
  const data = JSON.parse(json);
  if (!Array.isArray(data?.connections)) {
    throw new Error('Invalid file: expected a top-level "connections" array');
  }
  return (data.connections as StorageConnection[]).map(withStorageScope);
}

// A connection saved before "name" existed (or with a blank name typed in)
// falls back to its scoped bucket, then the provider — never an unlabeled row.
export function connectionLabel(conn: StorageConnection): string {
  return conn.name || conn.storageScope?.bucket || conn.bucket || STORAGE_TYPE_NAME[conn.type] || "(unnamed connection)";
}

export const STORAGE_TYPE_NAME: Record<StorageType, string> = {
  s3: "AWS S3",
  "s3-compat": "S3-compatible",
  azure: "Azure Blob Storage",
  gcs: "Google Cloud Storage",
  "tencent-cos": "Tencent Cloud COS",
  "alibaba-oss": "Alibaba Cloud OSS",
};

// Which catalog vendor a storage type belongs to, and back.
export const STORAGE_TYPE_VENDOR: Record<StorageType, VendorId> = {
  s3: "aws",
  "s3-compat": "s3compat",
  azure: "azure",
  gcs: "gcp",
  "tencent-cos": "tencent",
  "alibaba-oss": "alibaba",
};

export function storageTypeForVendor(vendor: VendorId): StorageType {
  const hit = (Object.keys(STORAGE_TYPE_VENDOR) as StorageType[]).find((t) => STORAGE_TYPE_VENDOR[t] === vendor);
  if (!hit) throw new Error(`No storage type for vendor ${vendor}`);
  return hit;
}

// Back-compat: a connection saved (or exported) when each one was pinned to
// a bucket has a top-level bucket(+prefix) — read it as storageScope, so it
// opens straight into that bucket as before. Already-migrated ones pass
// through unchanged.
export function withStorageScope(conn: StorageConnection): StorageConnection {
  if (!conn.bucket || conn.storageScope) return conn;
  const { bucket, prefix, ...rest } = conn;
  return { ...rest, storageScope: prefix ? { bucket, prefix } : { bucket } };
}

// The never-saved connection the bucket browser gets for one bucket: the
// stored keys plus that bucket (and, for AWS, its own region; the prefix as
// the hard root when the connection is limited to one).
export function bucketConnection(conn: StorageConnection, bucket: string, opts: { region?: string; prefix?: string } = {}): StorageConnection {
  return {
    ...conn,
    bucket,
    prefix: opts.prefix ?? "",
    ...(opts.region ? { region: opts.region } : {}),
  };
}

// A trailing slash keeps the prefix a clean folder boundary — it doubles as
// the hard root of browsing.
export function normalizePrefix(p: string): string {
  let out = p.replace(/^\/+/, "");
  if (out && !out.endsWith("/")) out += "/";
  return out;
}

// The endpoint field is a host, not a URL — tolerate a pasted
// "https://host/path" since that's what provider dashboards show.
export function normalizeEndpoint(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

// S3-compatible services don't share AWS's region namespace and the region
// is only ever a SigV4 scope string to them: R2 requires "auto", the rest
// accept (or ignore) "us-east-1". Derived instead of asked.
export function regionForEndpoint(endpoint: string): string {
  return /\.r2\.cloudflarestorage\.com$/i.test(endpoint) ? "auto" : "us-east-1";
}
