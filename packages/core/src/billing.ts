// Provider-agnostic billing shapes (AWS Cost Explorer and Tencent Billing
// both map into these) plus the shared name/category helpers.

export interface ServiceCost {
  /** The provider's own name — also the filter key for drilling into it. */
  serviceName: string;
  amount: number;
  /** Provider product code, where filtering needs it instead of the name (Tencent). */
  code?: string;
}

export interface UsageCost {
  name: string;
  amount: number;
}

export interface ResourceCost {
  /** Empty for usage not tied to a resource. */
  resourceID: string;
  amount: number;
  usage: UsageCost[];
}

export interface ServiceCostDetail {
  serviceName: string;
  unit: string;
  total: number;
  usage: UsageCost[];
  resources: ResourceCost[];
  /** The window `resources` covers (AWS keeps resource-level costs 14 days). */
  resourcesFrom?: string;
  resourcesTo?: string;
  /** Why `resources` is empty, when it couldn't be fetched. */
  resourcesNote?: string;
}

export interface MonthToDateCost {
  periodStart: string;
  periodEnd: string;
  total: number;
  unit: string;
  byService: ServiceCost[];
  isEstimated: boolean;
  /** Remaining prepaid balance (Tencent). */
  balance?: number;
}

const SHORT_SERVICE_NAMES: Record<string, string> = {
  "Amazon Simple Storage Service": "S3",
  "Amazon Elastic Compute Cloud - Compute": "EC2",
  "EC2 - Other": "EC2 Other",
  "Amazon Relational Database Service": "RDS",
  "AWS Lambda": "Lambda",
  "Amazon Elastic Load Balancing": "ELB",
  "AWS Key Management Service": "KMS",
  "Amazon Virtual Private Cloud": "VPC",
  "Amazon Simple Notification Service": "SNS",
  "Amazon Simple Queue Service": "SQS",
  "Amazon Simple Email Service": "SES",
  "Amazon Elastic Container Service": "ECS",
  "Amazon Elastic Container Service for Kubernetes": "EKS",
  "Amazon EC2 Container Registry (ECR)": "ECR",
  "Amazon Elastic File System": "EFS",
  "Amazon Elastic Block Store": "EBS",
  AmazonCloudWatch: "CloudWatch",
  "CloudWatch Events": "EventBridge",
  "Amazon OpenSearch Service": "OpenSearch",
  "Amazon Elastic MapReduce": "EMR",
};

/** "Amazon Simple Storage Service" → "S3", "AWS Secrets Manager" → "Secrets Manager", "对象存储 COS" → "COS". */
export function shortServiceName(name: string): string {
  const short = SHORT_SERVICE_NAMES[name];
  if (short) return short;
  for (const prefix of ["Amazon ", "AWS "]) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  const parts = name.split(" ").filter((p) => p.length > 0);
  const last = parts[parts.length - 1];
  if (last && last.length < name.length && /^[\x00-\x7F]+$/.test(last)) return last;
  return name;
}

/** Merged by name; zero rows dropped unless `keep` names them. Sorted by amount desc. */
export function mergeUsage(rows: [string, number][], keep: Set<string> = new Set()): UsageCost[] {
  const merged = new Map<string, number>();
  for (const [name, amount] of rows) merged.set(name, (merged.get(name) ?? 0) + amount);
  return [...merged.entries()]
    .filter(([name, amount]) => Math.abs(amount) >= 0.005 || keep.has(name))
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function resourcesFromRows(byResource: Map<string, [string, number][]>, keep?: Set<string>): ResourceCost[] {
  return [...byResource.entries()]
    .map(([resourceID, rows]) => {
      const usage = mergeUsage(rows, keep);
      return { resourceID, amount: usage.reduce((s, u) => s + u.amount, 0), usage };
    })
    .filter((r) => Math.abs(r.amount) >= 0.005)
    .sort((a, b) => b.amount - a.amount);
}

// UTC calendar helpers shared by both billing clients.
export function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthStartUTC(d: Date, offsetMonths = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
}

export function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
