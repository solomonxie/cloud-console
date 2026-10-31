// Cloud Storage buckets of a project (storage.buckets.list). Browsing a
// bucket's objects goes through storage/gcs.ts with the same credentials.

import type { GoogleCredentials } from "./auth.ts";
import { collectPages, gcpRequest } from "./request.ts";

export interface GcsBucket {
  name: string;
  location?: string;
  locationType?: string;
  storageClass?: string;
  timeCreated?: string;
}

interface ListBucketsResponse {
  items?: GcsBucket[];
  nextPageToken?: string;
}

export async function listBuckets(creds: GoogleCredentials, project: string): Promise<GcsBucket[]> {
  const buckets = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListBucketsResponse>(creds, "https://storage.googleapis.com/storage/v1/b", {
      query: { project, pageToken, maxResults: 1000 },
    });
    return { items: r.items ?? [], nextPageToken: r.nextPageToken };
  });
  return buckets.sort((a, b) => a.name.localeCompare(b.name));
}
