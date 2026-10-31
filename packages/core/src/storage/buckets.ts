// Account-level bucket listing for a vendor-level storage connection — the
// call the bucket-scoped StorageClient doesn't cover. Every request goes
// straight to that provider's own API, signed with the connection's key:
// - s3: ListBuckets on s3.amazonaws.com, then each bucket's region
// - s3-compat (R2, MinIO, …): ListBuckets on its own endpoint
// - alibaba-oss: ListBuckets on OSS's S3-compatible endpoint for the region
// - tencent-cos: GET Service on service.cos.myqcloud.com (COS v5 signing)
// - azure: List Containers on the storage account (Shared Key)
import { awsFetch } from "../aws/http.ts";
import { listBucketsWithRegions, parseListAllMyBuckets } from "../aws/s3-buckets.ts";
import { COSObjectStore } from "../tencent/cos.ts";
import { signRequest as azureSign } from "./azure-sig.ts";
import { regionForEndpoint, type StorageConnection } from "./connection.ts";
import { child, children, errorFromXml, parseXml, text, type XmlNode } from "./xml.ts";

export interface StorageBucket {
  name: string;
  // The bucket's own region, when the provider reports one (AWS, COS, OSS)
  // — the bucket browser must sign for that region, not the connection's.
  region?: string;
  creationDate?: string; // ISO 8601
}

const byName = (a: StorageBucket, b: StorageBucket) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// OSS reports a bucket's region as its Location, "oss-cn-hangzhou"; the
// connection (and S3Client's host) uses the bare "cn-hangzhou".
export function ossRegion(location: string): string {
  return location.replace(/^oss-/, "");
}

// ListAllMyBuckets on an S3-dialect endpoint other than AWS's own.
export function serviceUrl(conn: StorageConnection): { url: string; region: string } {
  if (conn.type === "s3-compat") {
    const endpoint = conn.endpoint ?? "";
    return { url: `https://${endpoint}/`, region: conn.region || regionForEndpoint(endpoint) };
  }
  if (conn.type === "alibaba-oss") {
    const region = conn.region || "cn-hangzhou";
    return { url: `https://s3.oss-${region}.aliyuncs.com/`, region };
  }
  throw new Error(`No S3 service endpoint for ${conn.type}`);
}

export interface ContainerPage {
  buckets: StorageBucket[];
  nextMarker?: string;
}

export function parseListContainers(xml: string): ContainerPage {
  const doc = parseXml(xml, ["Container"]);
  const root = doc.EnumerationResults as XmlNode | undefined;
  const buckets = children(child(root, "Containers"), "Container").map((c) => {
    const modified = text(child(c, "Properties"), "Last-Modified");
    const t = modified ? Date.parse(modified) : NaN;
    return { name: text(c, "Name"), ...(Number.isNaN(t) ? {} : { creationDate: new Date(t).toISOString() }) };
  });
  const next = text(root, "NextMarker");
  return { buckets, nextMarker: next || undefined };
}

export function azureListUrl(account: string, marker?: string): string {
  const url = new URL(`https://${account}.blob.core.windows.net/`);
  url.searchParams.set("comp", "list");
  if (marker) url.searchParams.set("marker", marker);
  return url.toString();
}

async function listAzureContainers(conn: StorageConnection): Promise<StorageBucket[]> {
  const account = conn.accessKeyId ?? "";
  const out: StorageBucket[] = [];
  let marker: string | undefined;
  do {
    const url = azureListUrl(account, marker);
    const headers = azureSign({ method: "GET", url, accountName: account, accountKey: conn.secretAccessKey ?? "" });
    const resp = await fetch(url, { method: "GET", headers });
    const body = await resp.text();
    if (!resp.ok) {
      const { code, message } = errorFromXml(body);
      throw new Error(code && message ? `${code}: ${message}` : `Azure list containers ${resp.status} ${resp.statusText}`);
    }
    const page = parseListContainers(body);
    out.push(...page.buckets);
    marker = page.nextMarker;
  } while (marker);
  return out.sort(byName);
}

export async function listBuckets(conn: StorageConnection): Promise<StorageBucket[]> {
  const key = { accessKeyId: conn.accessKeyId ?? "", secretAccessKey: conn.secretAccessKey ?? "" };
  switch (conn.type) {
    case "s3":
      return listBucketsWithRegions(key);
    case "s3-compat":
    case "alibaba-oss": {
      const { url, region } = serviceUrl(conn);
      const { text: body } = await awsFetch(key, { url, region, service: "s3" });
      const buckets = parseListAllMyBuckets(body).map((b) =>
        conn.type === "alibaba-oss" && b.region ? { ...b, region: ossRegion(b.region) } : b
      );
      return buckets.sort(byName);
    }
    case "tencent-cos":
      return new COSObjectStore({ secretId: key.accessKeyId, secretKey: key.secretAccessKey }).listBuckets();
    case "azure":
      return listAzureContainers(conn);
    case "gcs":
      throw new Error("Cloud Storage buckets are listed per project from a Google Cloud account.");
  }
}
