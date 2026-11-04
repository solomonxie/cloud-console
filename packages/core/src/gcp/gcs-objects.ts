// ObjectStore over GcsClient for the mobile bucket screens and queue. GCS
// buckets aren't regional endpoints, so `region` is ignored.
import type { GoogleCredentials } from "./auth.ts";
import { GcsClient } from "../storage/gcs.ts";
import type { ObjectStore, PutBody } from "../object-store.ts";
import type { ListPage } from "../storage/types.ts";

export class GcsObjectStore implements ObjectStore {
  readonly service = "gcs" as const;
  private readonly client: GcsClient;

  constructor(creds: GoogleCredentials) {
    this.client = new GcsClient({ id: "", type: "gcs", name: "", serviceAccountJson: JSON.stringify(creds) });
  }

  async listObjects(bucket: string, _region: string, prefix: string): Promise<ListPage> {
    const first = await this.client.listObjects(bucket, prefix);
    const page: ListPage = { folders: [...first.folders], objects: [...first.objects] };
    let token = first.nextToken;
    while (token) {
      const next = await this.client.listObjects(bucket, prefix, token);
      page.folders.push(...next.folders);
      page.objects.push(...next.objects);
      token = next.nextToken;
    }
    return page;
  }

  async listAllKeys(bucket: string, _region: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const k of this.client.listAllKeys(bucket, prefix)) keys.push(k);
    return keys;
  }

  async download(bucket: string, _region: string, key: string): Promise<ArrayBuffer> {
    return (await this.client.getObjectBlob(bucket, key)).arrayBuffer();
  }

  presignedUrl(bucket: string, _region: string, key: string, expiresIn = 3600): Promise<string> {
    return this.client.presignedUrl(bucket, key, expiresIn);
  }

  deleteObject(bucket: string, _region: string, key: string): Promise<void> {
    return this.client.deleteObject(bucket, key);
  }

  async batchDelete(bucket: string, _region: string, keys: string[]): Promise<void> {
    for (const k of keys) await this.client.deleteObject(bucket, k);
  }

  copyObject(o: { sourceBucket: string; sourceKey: string; destBucket: string; destKey: string }): Promise<void> {
    return this.client.copyObject(o.destBucket, o.destKey, o.sourceBucket, o.sourceKey);
  }

  putObject(bucket: string, _region: string, key: string, body: PutBody, contentType?: string): Promise<void> {
    return this.client.putObject(bucket, key, body, contentType);
  }

  // GCS has no MD5-style ETag for composite objects; never block an upload.
  async headETag(): Promise<string | undefined> {
    return undefined;
  }
}
