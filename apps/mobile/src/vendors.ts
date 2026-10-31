// Per-vendor and per-kind presentation that the shared catalog doesn't carry.
import type { ResourceKindId, VendorId } from "@cloud-console/core/catalog";

export const VENDOR_ICON = "cloud.fill";

export const KIND_ICON: Record<ResourceKindId, string> = {
  billing: "creditcard.fill",
  s3: "archivebox.fill",
  cos: "archivebox.fill",
  gcs: "archivebox.fill",
  azureBlob: "archivebox.fill",
  oss: "archivebox.fill",
  s3compatBuckets: "archivebox.fill",
  iamUsers: "person.fill",
  camUsers: "person.fill",
  iamRoles: "person.2.badge.key.fill",
  camRoles: "person.2.badge.key.fill",
  ec2: "server.rack",
  cvm: "server.rack",
  gceInstances: "server.rack",
  gceInstanceGroups: "server.rack",
  lambda: "bolt.fill",
  scf: "bolt.fill",
  rds: "cylinder.split.1x2.fill",
  cdb: "cylinder.split.1x2.fill",
  eventBridge: "arrow.triangle.branch",
  tencentEventBridge: "arrow.triangle.branch",
  parameterStore: "slider.horizontal.3",
  gcpSecrets: "key.fill",
  gcpProjects: "folder.fill",
  cloudWatchAlarms: "waveform.path.ecg",
  monitorAlarms: "waveform.path.ecg",
};

export interface CredentialShape {
  idLabel: string;
  secretLabel: string;
  help: string;
  learnMore: string;
}

export const CREDENTIAL: Partial<Record<VendorId, CredentialShape>> = {
  aws: {
    idLabel: "Access key ID",
    secretLabel: "Secret access key",
    help: "An IAM user access key. This app only ever does what that key's own permissions allow — give it read-only, or read/write on just what you want browsable here.",
    learnMore: "https://github.com/solomonxie/cloud-console/blob/master/docs/access-keys.md#aws",
  },
  tencent: {
    idLabel: "SecretId",
    secretLabel: "SecretKey",
    help: "A CAM sub-user API key (SecretId and SecretKey). This app only ever does what that key's own policies allow — give it read-only, or access to just what you want browsable here.",
    learnMore: "https://github.com/solomonxie/cloud-console/blob/master/docs/access-keys.md#tencent-cloud",
  },
};
