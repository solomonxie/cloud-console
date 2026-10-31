// Chrome-side presentation for catalog vendors and resource kinds — what the
// shared catalog doesn't carry (display names, accents, icons), and which
// resource kind is a storage connection's bucket list.
import { availableVendors, resourceKinds, type ResourceKind, type ResourceKindId, type Vendor, type VendorId } from "@cloud-console/core/catalog";
import { STORAGE_TYPE_VENDOR, type StorageConnection } from "@cloud-console/core/storage/connection";
import type { StorageType } from "@cloud-console/core/storage/types";

// Same accents as the mobile app (apps/mobile/src/theme.ts VENDOR_ACCENT).
export const VENDOR_ACCENT: Record<VendorId, string> = {
  aws: "#FF9500",
  azure: "#007AFF",
  gcp: "#FF3B30",
  tencent: "#30B0C7",
  alibaba: "#FF2D55",
  s3compat: "#8E8E93",
};

// Full names for the "+" chooser and form titles (the catalog's are short).
export const VENDOR_NAME: Record<VendorId, string> = {
  aws: "Amazon Web Services",
  gcp: "Google Cloud",
  azure: "Microsoft Azure",
  alibaba: "Alibaba Cloud",
  tencent: "Tencent Cloud",
  s3compat: "S3-compatible",
};

// Chooser order, like the mobile app's provider list.
const VENDOR_ORDER: VendorId[] = ["aws", "gcp", "azure", "alibaba", "tencent", "s3compat"];

// The kind a storage connection's bucket row is, per storage type.
export const STORAGE_KIND: Record<StorageType, ResourceKindId> = {
  s3: "s3",
  "s3-compat": "s3compatBuckets",
  azure: "azureBlob",
  gcs: "gcs",
  "tencent-cos": "cos",
  "alibaba-oss": "oss",
};

export const KIND_ICON: Partial<Record<ResourceKindId, string>> = {
  s3: "bucket",
  s3compatBuckets: "bucket",
  azureBlob: "bucket",
  cos: "bucket",
  oss: "bucket",
  gcs: "bucket",
  gceInstances: "server",
  gceInstanceGroups: "layers",
  gcpSecrets: "key",
};

// Vendors with at least one implemented Chrome resource kind, in chooser order.
export function chromeVendors(): Vendor[] {
  return availableVendors("chrome").sort((a, b) => VENDOR_ORDER.indexOf(a.id) - VENDOR_ORDER.indexOf(b.id));
}

// The kinds a storage connection can show: its vendor's implemented Chrome
// kinds that a storage connection renders (today: the bucket list).
export function storageKinds(type: StorageType): ResourceKind[] {
  return resourceKinds(STORAGE_TYPE_VENDOR[type], "chrome").filter((k) => k.id === STORAGE_KIND[type]);
}

// The ones this connection has selected (absent `resources` = all).
export function selectedKinds<T extends { id: ResourceKindId }>(kinds: T[], resources: ResourceKindId[] | undefined): T[] {
  return resources ? kinds.filter((k) => resources.includes(k.id)) : kinds;
}

export function storageVendor(conn: StorageConnection): VendorId {
  return STORAGE_TYPE_VENDOR[conn.type] ?? "aws";
}
