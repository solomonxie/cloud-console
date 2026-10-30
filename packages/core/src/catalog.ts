// Every vendor and resource kind, implemented or not, in build order. A
// kind stays out of the UI until it's implemented (App Review 2.1/2.2) —
// UIs only ever read `resourceKinds(vendor, platform)` / `availableVendors`.

export type Platform = "mobile" | "chrome";

export type VendorId = "aws" | "azure" | "gcp" | "tencent" | "alibaba";

export interface Vendor {
  id: VendorId;
  name: string;
  // Platforms this vendor ships on at all in this version.
  platforms: Platform[];
}

export const VENDORS: Vendor[] = [
  { id: "aws", name: "AWS", platforms: ["mobile", "chrome"] },
  { id: "azure", name: "Azure", platforms: ["chrome"] },
  { id: "gcp", name: "Google Cloud", platforms: ["chrome"] },
  { id: "tencent", name: "Tencent Cloud", platforms: ["mobile"] },
  { id: "alibaba", name: "Alibaba Cloud", platforms: ["chrome"] },
];

export type ResourceKindId =
  | "billing"
  | "s3"
  | "iamUsers"
  | "iamRoles"
  | "ec2"
  | "lambda"
  | "rds"
  | "eventBridge"
  | "parameterStore"
  | "cloudWatchAlarms"
  | "cos"
  | "camUsers"
  | "camRoles"
  | "cvm"
  | "scf"
  | "cdb"
  | "tencentEventBridge"
  | "monitorAlarms"
  | "gcpProjects"
  | "gcs"
  | "gceInstances"
  | "gceInstanceGroups"
  | "gcpSecrets";

export interface ResourceKind {
  id: ResourceKindId;
  vendor: VendorId;
  title: string;
  isImplemented: boolean;
  platforms: Platform[];
}

const both: Platform[] = ["mobile", "chrome"];

export const RESOURCE_KINDS: ResourceKind[] = [
  { id: "billing", vendor: "aws", title: "Billing", isImplemented: true, platforms: ["mobile"] },
  { id: "s3", vendor: "aws", title: "S3 Buckets", isImplemented: true, platforms: both },
  { id: "iamUsers", vendor: "aws", title: "IAM Users", isImplemented: true, platforms: ["mobile"] },
  { id: "iamRoles", vendor: "aws", title: "IAM Roles", isImplemented: true, platforms: ["mobile"] },
  { id: "ec2", vendor: "aws", title: "EC2 Instances", isImplemented: true, platforms: ["mobile"] },
  { id: "lambda", vendor: "aws", title: "Lambda Functions", isImplemented: true, platforms: ["mobile"] },
  { id: "rds", vendor: "aws", title: "Databases", isImplemented: false, platforms: both },
  { id: "eventBridge", vendor: "aws", title: "EventBridge", isImplemented: true, platforms: ["mobile"] },
  { id: "parameterStore", vendor: "aws", title: "Parameter Store", isImplemented: true, platforms: ["mobile"] },
  { id: "cloudWatchAlarms", vendor: "aws", title: "CloudWatch Alarms", isImplemented: false, platforms: both },

  { id: "billing", vendor: "tencent", title: "Billing", isImplemented: true, platforms: ["mobile"] },
  { id: "cos", vendor: "tencent", title: "COS Buckets", isImplemented: true, platforms: ["mobile"] },
  { id: "camUsers", vendor: "tencent", title: "CAM Users", isImplemented: true, platforms: ["mobile"] },
  { id: "camRoles", vendor: "tencent", title: "CAM Roles", isImplemented: true, platforms: ["mobile"] },
  { id: "cvm", vendor: "tencent", title: "CVM Instances", isImplemented: true, platforms: ["mobile"] },
  { id: "scf", vendor: "tencent", title: "Cloud Functions", isImplemented: false, platforms: ["mobile"] },
  { id: "cdb", vendor: "tencent", title: "CDB Databases", isImplemented: false, platforms: ["mobile"] },
  { id: "tencentEventBridge", vendor: "tencent", title: "EventBridge (CEB)", isImplemented: true, platforms: ["mobile"] },
  { id: "monitorAlarms", vendor: "tencent", title: "Cloud Monitor Alarms", isImplemented: false, platforms: ["mobile"] },

  { id: "gcpProjects", vendor: "gcp", title: "Projects", isImplemented: true, platforms: ["chrome"] },
  { id: "gcs", vendor: "gcp", title: "Cloud Storage", isImplemented: true, platforms: ["chrome"] },
  { id: "gceInstances", vendor: "gcp", title: "VM Instances", isImplemented: true, platforms: ["chrome"] },
  { id: "gceInstanceGroups", vendor: "gcp", title: "Instance Groups", isImplemented: true, platforms: ["chrome"] },
  { id: "gcpSecrets", vendor: "gcp", title: "Secrets", isImplemented: true, platforms: ["chrome"] },
];

export function resourceKinds(vendor: VendorId, platform: Platform): ResourceKind[] {
  return RESOURCE_KINDS.filter(
    (k) => k.vendor === vendor && k.isImplemented && k.platforms.includes(platform)
  );
}

export function availableVendors(platform: Platform): Vendor[] {
  return VENDORS.filter(
    (v) => v.platforms.includes(platform) && resourceKinds(v.id, platform).length > 0
  );
}
