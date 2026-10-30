// Account-level S3 calls the bucket-scoped StorageClient doesn't cover:
// ListBuckets (global, us-east-1) and the unauthenticated region lookup.
import type { AwsKey } from "./sigv4.ts";
import { awsFetch } from "./http.ts";
import { ancestor, walkXml } from "./xml.ts";

export interface Bucket {
  name: string;
  creationDate?: string; // ISO 8601
  region?: string;
}

export async function listBuckets(key: AwsKey): Promise<Bucket[]> {
  const { text } = await awsFetch(key, { url: "https://s3.amazonaws.com/", region: "us-east-1", service: "s3" });
  return parseListAllMyBuckets(text);
}

/** Unauthenticated HEAD reading `x-amz-bucket-region` — works without s3:GetBucketLocation. */
export async function bucketRegion(name: string): Promise<string> {
  try {
    const response = await fetch(`https://${name}.s3.amazonaws.com/`, { method: "HEAD" });
    return response.headers.get("x-amz-bucket-region") || "us-east-1";
  } catch {
    return "us-east-1";
  }
}

/** Buckets with their regions resolved concurrently, sorted by name. */
export async function listBucketsWithRegions(key: AwsKey): Promise<Bucket[]> {
  const list = await listBuckets(key);
  await Promise.all(
    list.map(async (b) => {
      b.region = await bucketRegion(b.name);
    })
  );
  return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Also parses COS's ListAllMyBuckets (CreateDate/Location instead of CreationDate). */
export function parseListAllMyBuckets(xml: string): Bucket[] {
  const buckets: Bucket[] = [];
  let name: string | undefined;
  let date: string | undefined;
  let location: string | undefined;
  walkXml(xml, (path, text) => {
    const last = path[path.length - 1];
    const inBucket = ancestor(path, 1) === "Bucket";
    if (last === "Name" && inBucket) name = text;
    else if ((last === "CreationDate" || last === "CreateDate") && inBucket) date = text;
    else if (last === "Location" && inBucket) location = text;
    else if (last === "Bucket") {
      if (name) {
        const t = date ? Date.parse(date) : NaN;
        buckets.push({
          name,
          ...(Number.isNaN(t) ? {} : { creationDate: new Date(t).toISOString() }),
          ...(location ? { region: location } : {}),
        });
      }
      name = date = location = undefined;
    }
  });
  return buckets;
}

/** S3 and COS both use raw enum names; absent means STANDARD. */
export function storageClassLabel(storageClass: string | undefined): string {
  const c = storageClass ?? "STANDARD";
  const labels: Record<string, string> = {
    STANDARD: "Standard", STANDARD_IA: "Standard-IA", ONEZONE_IA: "One Zone-IA",
    INTELLIGENT_TIERING: "Intelligent Tiering", ARCHIVE: "Archive", DEEP_ARCHIVE: "Deep Archive",
    GLACIER: "Glacier Flexible", GLACIER_IR: "Glacier Instant", REDUCED_REDUNDANCY: "Reduced Redundancy",
    EXPRESS_ONEZONE: "Express One Zone", MAZ_STANDARD: "Standard (MAZ)", MAZ_STANDARD_IA: "Standard-IA (MAZ)",
    MAZ_INTELLIGENT_TIERING: "Intelligent Tiering (MAZ)",
  };
  return (
    labels[c] ??
    c
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
}
