// The method surface every bucket-scoped storage client exposes (S3 and
// S3-compatible incl. Tencent COS/Alibaba OSS, Azure Blob, GCS), so UIs
// never branch on connection type.

export type StorageType = "s3" | "s3-compat" | "azure" | "gcs" | "tencent-cos" | "alibaba-oss";

export interface StorageObject {
  key: string;
  size: number;
  lastModified?: string; // as the provider reports it (ISO 8601 or RFC 1123)
  storageClass?: string;
}

export interface ListPage {
  folders: string[]; // common prefixes, each ending in "/"
  objects: StorageObject[];
  nextToken?: string; // set only when more results remain
}

export type Progress = (done: number) => void;

export type Body = Blob | ArrayBuffer | Uint8Array | string;

export interface StorageClient {
  readonly scheme: string; // "s3" | "az" | "gs" | "cos" | "oss"
  // False only for GCS with gcloud user credentials (no key to sign with):
  // callers fetch the object instead of presigning, and hide signed links.
  readonly canPresign: boolean;
  listObjects(bucket: string, prefix: string, token?: string): Promise<ListPage>;
  listAllKeys(bucket: string, prefix: string): AsyncIterable<string>;
  getObjectBlob(bucket: string, key: string): Promise<Blob>;
  putObject(bucket: string, key: string, body: Body, contentType?: string): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  // Recursive; resolves to the number of objects deleted.
  deletePrefix(bucket: string, prefix: string, onProgress?: Progress): Promise<number>;
  copyObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void>;
  moveObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void>;
  // Recursive; resolves to the number of objects copied.
  copyPrefix(bucket: string, destPrefix: string, sourceBucket: string, sourcePrefix: string, onProgress?: Progress): Promise<number>;
  createFolder(bucket: string, prefix: string): Promise<void>;
  resourceUri(bucket: string, key: string): string;
  unsignedUrl(bucket: string, key: string): string;
  presignedUrl(bucket: string, key: string, expiresIn?: number): Promise<string>;
}
