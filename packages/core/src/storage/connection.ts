// A saved storage connection — exactly the shape the Chrome extension has
// always kept in chrome.storage.local and written to export files, so
// existing saved connections and exports keep loading. Field meaning by type:
// - s3 / tencent-cos / alibaba-oss: accessKeyId + secretAccessKey + region
// - s3-compat: same, plus endpoint (host only); region derived from it
// - azure: accessKeyId = storage account name, secretAccessKey = account key
// - gcs: serviceAccountJson = the raw credentials JSON (service account key
//   or gcloud authorized_user ADC — named for the original shape)
import type { StorageType } from "./types.ts";

export interface StorageConnection {
  id: string;
  type: StorageType;
  name: string;
  bucket: string;
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
  return data.connections;
}

// A connection saved before "name" existed (or with a blank name typed in)
// falls back to the bucket, then a placeholder — never an unlabeled row.
export function connectionLabel(conn: StorageConnection): string {
  return conn.name || conn.bucket || "(unnamed connection)";
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
