// Picks the right backend client for a connection's type. "s3", "s3-compat",
// "tencent-cos" and "alibaba-oss" all speak the S3 REST dialect (COS and OSS
// through their own documented S3-compatible endpoints); "azure" and "gcs"
// are genuinely different auth/APIs (Azure Shared Key + Blob REST; GCS
// OAuth token + JSON Storage API) but expose the same StorageClient
// surface, so UIs never branch on type themselves.
import { AzureClient } from "./azure.ts";
import type { StorageConnection } from "./connection.ts";
import { GcsClient } from "./gcs.ts";
import { S3Client } from "./s3.ts";
import type { StorageClient } from "./types.ts";

export function createClient(conn: StorageConnection): StorageClient {
  if (conn.type === "azure") return new AzureClient(conn);
  if (conn.type === "gcs") return new GcsClient(conn);
  return new S3Client(conn);
}
