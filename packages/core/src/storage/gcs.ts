// Bucket-scoped client for Google Cloud Storage's JSON API, authenticated
// with a service account key or gcloud user credentials (gcp/auth.ts).
import {
  canSign,
  getAccessToken,
  signedUrlV4,
  type GoogleCredentials,
} from "../gcp/auth.ts";
import type { StorageConnection } from "./connection.ts";
import type { Body, ListPage, Progress, StorageClient } from "./types.ts";
import { copyPrefix, deletePrefix, folderKey, setQuery } from "./walk.ts";

const PAGE_SIZE = 100;
const API_BASE = "https://storage.googleapis.com/storage/v1";
const UPLOAD_BASE = "https://storage.googleapis.com/upload/storage/v1";
export const SCOPE_DEVSTORAGE_READ_WRITE = "https://www.googleapis.com/auth/devstorage.read_write";

interface GcsObject {
  name: string;
  size?: string;
  updated?: string;
  storageClass?: string;
}

interface GcsListResponse {
  prefixes?: string[];
  items?: GcsObject[];
  nextPageToken?: string;
}

interface RequestOpts {
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: Body;
  base?: string;
}

export class GcsClient implements StorageClient {
  readonly scheme = "gs";
  private readonly credentials: GoogleCredentials;

  constructor(conn: StorageConnection) {
    // Named for the original (service account only) shape; it holds either
    // credentials type.
    this.credentials = JSON.parse(conn.serviceAccountJson ?? "");
  }

  // User credentials have no private key to sign a URL with — callers fall
  // back to fetching the object for previews and hide signed share links.
  get canPresign(): boolean {
    return canSign(this.credentials);
  }

  private async request(method: string, path: string, opts: RequestOpts = {}): Promise<Response> {
    const url = setQuery(new URL(`${opts.base ?? API_BASE}${path}`), opts.query ?? {});
    const token = await getAccessToken(this.credentials, SCOPE_DEVSTORAGE_READ_WRITE);
    const resp = await fetch(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...opts.headers },
      body: opts.body as BodyInit | undefined,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      let message: string | undefined;
      try {
        message = JSON.parse(body)?.error?.message;
      } catch {
        // not JSON — fall through to the generic message below
      }
      throw new Error(message || `GCS ${method} ${resp.status} ${resp.statusText}`);
    }
    return resp;
  }

  private objectPath(bucket: string, key: string): string {
    return `/b/${bucket}/o/${encodeURIComponent(key)}`;
  }

  async listObjects(bucket: string, prefix: string, token?: string): Promise<ListPage> {
    const resp = await this.request("GET", `/b/${bucket}/o`, {
      query: { prefix, delimiter: "/", maxResults: String(PAGE_SIZE), pageToken: token || undefined },
    });
    const data = (await resp.json()) as GcsListResponse;
    return {
      folders: data.prefixes ?? [],
      objects: (data.items ?? []).map((it) => ({
        key: it.name,
        size: Number(it.size || 0),
        lastModified: it.updated,
        storageClass: it.storageClass || undefined,
      })),
      nextToken: data.nextPageToken || undefined,
    };
  }

  async *listAllKeys(bucket: string, prefix: string): AsyncIterable<string> {
    let token: string | undefined;
    do {
      const resp = await this.request("GET", `/b/${bucket}/o`, { query: { prefix, pageToken: token } });
      const data = (await resp.json()) as GcsListResponse;
      for (const it of data.items ?? []) yield it.name;
      token = data.nextPageToken || undefined;
    } while (token);
  }

  async getObjectBlob(bucket: string, key: string): Promise<Blob> {
    const resp = await this.request("GET", this.objectPath(bucket, key), { query: { alt: "media" } });
    return resp.blob();
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.request("DELETE", this.objectPath(bucket, key));
  }

  deletePrefix(bucket: string, prefix: string, onProgress?: Progress): Promise<number> {
    return deletePrefix(this, bucket, prefix, onProgress);
  }

  async copyObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void> {
    await this.request(
      "POST",
      `${this.objectPath(sourceBucket, sourceKey)}/copyTo/b/${bucket}/o/${encodeURIComponent(key)}`
    );
  }

  async moveObject(bucket: string, key: string, sourceBucket: string, sourceKey: string): Promise<void> {
    await this.copyObject(bucket, key, sourceBucket, sourceKey);
    await this.deleteObject(sourceBucket, sourceKey);
  }

  copyPrefix(bucket: string, destPrefix: string, sourceBucket: string, sourcePrefix: string, onProgress?: Progress): Promise<number> {
    return copyPrefix(this, bucket, destPrefix, sourceBucket, sourcePrefix, onProgress);
  }

  // Simple (non-resumable) media upload — fine for the file sizes edited or
  // uploaded inline; large files would want the resumable upload flow.
  async putObject(bucket: string, key: string, body: Body, contentType?: string): Promise<void> {
    await this.request("POST", `/b/${bucket}/o`, {
      base: UPLOAD_BASE,
      query: { uploadType: "media", name: key },
      headers: { "content-type": contentType || "application/octet-stream" },
      body,
    });
  }

  async createFolder(bucket: string, prefix: string): Promise<void> {
    await this.putObject(bucket, folderKey(prefix), new Uint8Array(0));
  }

  // Share links: a gs:// URI, an unsigned HTTP URL (only useful on a public
  // bucket/object), and a time-limited V4-signed URL.
  resourceUri(bucket: string, key: string): string {
    return `gs://${bucket}/${key}`;
  }

  unsignedUrl(bucket: string, key: string): string {
    return new URL(`https://storage.googleapis.com/${bucket}/${key}`).toString();
  }

  async presignedUrl(bucket: string, key: string, expiresIn = 3600): Promise<string> {
    if (!canSign(this.credentials)) {
      throw new Error("Signed links need a service account key, not gcloud user credentials.");
    }
    return signedUrlV4({ serviceAccount: this.credentials, bucket, object: key, expiresIn });
  }
}
