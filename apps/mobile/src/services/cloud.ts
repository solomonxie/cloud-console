// Every provider call the screens make, demo-aware: in demo mode the answer
// comes from the preset and nothing touches the network, Keychain or cache.
import type { AwsKey } from "@cloud-console/core/aws/sigv4";
import type { TencentKey } from "@cloud-console/core/tencent/tc3";
import * as ec2 from "@cloud-console/core/aws/ec2";
import * as lambda from "@cloud-console/core/aws/lambda";
import * as iam from "@cloud-console/core/aws/iam";
import * as ce from "@cloud-console/core/aws/cost-explorer";
import * as logs from "@cloud-console/core/aws/cloudwatch-logs";
import * as metrics from "@cloud-console/core/aws/cloudwatch-metrics";
import * as ssm from "@cloud-console/core/aws/parameter-store";
import * as eb from "@cloud-console/core/aws/eventbridge";
import * as sts from "@cloud-console/core/aws/sts";
import { listBucketsWithRegions, type Bucket } from "@cloud-console/core/aws/s3-buckets";
import { enabledRegions } from "@cloud-console/core/aws/regions";
import { S3ObjectStore } from "@cloud-console/core/aws/s3-objects";
import * as tcBilling from "@cloud-console/core/tencent/billing";
import * as cam from "@cloud-console/core/tencent/cam";
import * as cvm from "@cloud-console/core/tencent/cvm";
import * as ceb from "@cloud-console/core/tencent/eventbridge";
import * as tcSts from "@cloud-console/core/tencent/sts";
import { COSObjectStore } from "@cloud-console/core/tencent/cos";
import { DemoUnavailableError, demoFixtureName } from "@cloud-console/core/demo/cloud";
import type { ObjectStore, StorageService } from "@cloud-console/core/object-store";
import type { ListPage } from "@cloud-console/core/storage/types";
import type { MonthToDateCost, ServiceCost, ServiceCostDetail } from "@cloud-console/core/billing";
import type { EventBridgeItem } from "@cloud-console/core/events";
import type { ResourceDetail } from "@cloud-console/core/detail";
import type { VendorId } from "@cloud-console/core/catalog";
import { DEFAULT_RESOURCE_TTL } from "@cloud-console/core/cache";
import { isDemo } from "./settings";
import { demo } from "./demo";
import { resourceCache } from "./cache";
import { loadCredential } from "./keychain";
import type { Connection } from "../state/connections";

/** A connection's resolved key; `id` is the access key id (or the demo fixture name). */
export interface Session {
  connection: Connection;
  id: string;
  aws: AwsKey;
  tencent: TencentKey;
}

export async function openSession(connection: Connection): Promise<Session> {
  if (isDemo()) {
    const id = demoFixtureName(connection.vendor);
    return { connection, id, aws: { accessKeyId: id, secretAccessKey: "demo" }, tencent: { secretId: id, secretKey: "demo" } };
  }
  const stored = await loadCredential(connection.id);
  const pair = stored && "keyPair" in stored ? stored.keyPair : { id: "", secret: "" };
  return {
    connection,
    id: pair.id,
    aws: { accessKeyId: pair.id, secretAccessKey: pair.secret },
    tencent: { secretId: pair.id, secretKey: pair.secret },
  };
}

/** Cached fetch keyed like the Swift app (`<kind>[@region]:<key id>[:suffix]`). */
export async function cached<T>(key: string, fetch: () => Promise<T>, opts: { ttl?: number; force?: boolean } = {}): Promise<T> {
  if (isDemo()) return demo.value<T>(key);
  return resourceCache.cached(key, opts.ttl ?? DEFAULT_RESOURCE_TTL, opts.force ?? false, fetch);
}

export async function staleValue<T>(key: string): Promise<T | undefined> {
  if (isDemo()) {
    try {
      return demo.value<T>(key);
    } catch {
      return undefined;
    }
  }
  return resourceCache.stale<T>(key);
}

// Key validation (Add connection)

export async function validateKey(vendor: VendorId, id: string, secret: string): Promise<void> {
  if (isDemo()) return;
  if (vendor === "aws") await sts.validateKey({ accessKeyId: id, secretAccessKey: secret });
  else if (vendor === "tencent") await tcSts.validateKey({ secretId: id, secretKey: secret });
}

// Regions (cached a day)

export async function awsRegions(s: Session, force = false): Promise<string[]> {
  let listed: string[] | undefined;
  try {
    listed = await cached(`aws-regions:${s.id}`, () => ec2.listRegions(s.aws), { ttl: 86_400_000, force });
  } catch {
    listed = undefined;
  }
  return enabledRegions(listed);
}

// Storage

export function objectStore(s: Session, service: StorageService): ObjectStore {
  return service === "s3" ? new S3ObjectStore(s.aws) : new COSObjectStore(s.tencent);
}

export function listBuckets(s: Session, service: StorageService, force: boolean): Promise<Bucket[]> {
  if (service === "s3") return cached(`s3-buckets:${s.id}`, () => listBucketsWithRegions(s.aws), { force });
  return cached(`cos-buckets:${s.id}`, () => new COSObjectStore(s.tencent).listBuckets(), { force });
}

/** Always live — folder contents change too often to risk a stale listing. */
export function listObjects(s: Session, service: StorageService, bucket: string, region: string, prefix: string): Promise<ListPage> {
  if (isDemo()) return Promise.resolve(demo.objects(s.id, bucket, prefix));
  return objectStore(s, service).listObjects(bucket, region, prefix);
}

export async function downloadObject(s: Session, service: StorageService, bucket: string, region: string, key: string): Promise<ArrayBuffer | string> {
  if (isDemo()) return demo.download(key);
  return objectStore(s, service).download(bucket, region, key);
}

export function presignedUrl(s: Session, service: StorageService, bucket: string, region: string, key: string): string {
  return objectStore(s, service).presignedUrl(bucket, region, key, 3600);
}

// Compute

export const listEC2 = (s: Session, region: string) => ec2.listInstances(s.aws, region);
export const listLambda = (s: Session, region: string) => lambda.listFunctions(s.aws, region);
export const listParameters = (s: Session, region: string) => ssm.listParameters(s.aws, region);
export const listEventBridge = (s: Session, region: string) => eb.listItems(s.aws, region);

export async function ec2StatusChecks(s: Session, instanceId: string, region: string) {
  if (isDemo()) return { system: "ok", instance: "ok", ebs: "ok" };
  return ec2.statusChecks(s.aws, instanceId, region);
}

export async function metricSeries(s: Session, queries: metrics.MetricQuery[], from: number, to: number, period: number, region: string) {
  if (isDemo()) return demo.metrics(queries.map((q) => q.id), from, to, period);
  return metrics.metricSeries(s.aws, { queries, from, to, period, region });
}

export async function invokeLambda(s: Session, name: string, payload: string, region: string): Promise<lambda.LambdaInvocation> {
  if (isDemo()) return demo.invoke(name, payload);
  return lambda.invoke(s.aws, name, payload, region);
}

export function lambdaLogs(s: Session, fn: string, from: number, to: number, region: string) {
  return logs.filterEvents(s.aws, { logGroup: logs.lambdaLogGroup(fn), from, to, region });
}

export function listCVM(s: Session, force: boolean) {
  return cached(`cvm-instances:${s.id}`, () => cvm.listInstances(s.tencent), { force });
}

// IAM / CAM

export function listIAMUsers(s: Session, force: boolean) {
  return s.connection.vendor === "tencent"
    ? cached(`cam-users:${s.id}`, () => cam.listUsers(s.tencent), { force })
    : cached(`iam-users:${s.id}`, () => iam.listUsers(s.aws), { force });
}

export function listIAMRoles(s: Session, force: boolean) {
  return s.connection.vendor === "tencent"
    ? cached(`cam-roles:${s.id}`, () => cam.listRoles(s.tencent), { force })
    : cached(`iam-roles:${s.id}`, () => iam.listRoles(s.aws), { force });
}

export interface PolicyRef {
  title: string;
  subtitle?: string;
  load: () => Promise<string>;
}

/** Attached + inline policies for a user or role, each loading its document on expand. */
export async function principalPolicies(s: Session, kind: "user" | "role", name: string, arn: string): Promise<{ attached: PolicyRef[]; inline: PolicyRef[] | undefined }> {
  if (s.connection.vendor === "tencent") {
    const list = isDemo()
      ? demo.camPolicyNames(s.id, arn).map((n) => ({ policyID: 0, name: n }))
      : kind === "user"
        ? await cam.listAttachedUserPolicies(s.tencent, arn)
        : await cam.listAttachedRolePolicies(s.tencent, arn);
    return {
      attached: list.map((p) => ({
        title: p.name,
        load: () => (isDemo() ? Promise.resolve(demo.policyDocument(s.id, p.name)) : cam.policyDocument(s.tencent, p)),
      })),
      inline: undefined,
    };
  }
  if (isDemo()) {
    return {
      attached: demo.attachedPolicies(s.id, name).map((p) => ({ title: p.policyName, subtitle: p.policyArn, load: async () => demo.policyDocument(s.id, p.policyArn) })),
      inline: demo.inlinePolicyNames(s.id, name).map((n) => ({ title: n, load: async () => demo.policyDocument(s.id, n) })),
    };
  }
  const [attached, inline] =
    kind === "user"
      ? await Promise.all([iam.listAttachedUserPolicies(s.aws, name), iam.listUserPolicyNames(s.aws, name)])
      : await Promise.all([iam.listAttachedRolePolicies(s.aws, name), iam.listRolePolicyNames(s.aws, name)]);
  return {
    attached: attached.map((p) => ({ title: p.policyName, subtitle: p.policyArn, load: () => iam.attachedPolicyDocument(s.aws, p.policyArn) })),
    inline: inline.map((n) => ({
      title: n,
      load: () => (kind === "user" ? iam.inlineUserPolicyDocument(s.aws, name, n) : iam.inlineRolePolicyDocument(s.aws, name, n)),
    })),
  };
}

// Billing

export function monthToDate(s: Session, force: boolean): Promise<MonthToDateCost> {
  return cached(`billing-mtd:${s.id}`, () => (s.connection.vendor === "tencent" ? tcBilling.monthToDateCost(s.tencent) : ce.monthToDateCost(s.aws)), { force });
}

export function billingHistory(s: Session, force: boolean): Promise<MonthToDateCost[]> {
  // The month in the key drops stale pre-rollover data.
  const month = new Date().toISOString().slice(0, 7);
  return cached(
    `billing-history:${s.id}:${month}`,
    () => (s.connection.vendor === "tencent" ? tcBilling.monthlyBills(s.tencent, 11) : ce.monthlyBills(s.aws, 11)),
    { force }
  );
}

export async function serviceDetail(s: Session, service: ServiceCost, bill: MonthToDateCost, force: boolean): Promise<ServiceCostDetail> {
  if (isDemo()) {
    const detail = demo.value<Partial<ServiceCostDetail>>(`billing-detail@${service.serviceName}:${s.id}`);
    if (!Array.isArray(detail.usage) || !Array.isArray(detail.resources)) throw new DemoUnavailableError();
    return detail as ServiceCostDetail;
  }
  return cached(
    `billing-detail@${service.serviceName}:${s.id}:${bill.periodStart}`,
    () =>
      s.connection.vendor === "tencent"
        ? tcBilling.serviceDetail(s.tencent, service, bill.periodStart.slice(0, 7))
        : ce.serviceDetail(s.aws, service.serviceName, bill.periodStart, bill.periodEnd),
    { ttl: 3_600_000, force }
  );
}

// Events / Parameters

export function listTencentEvents(s: Session, force: boolean): Promise<EventBridgeItem[]> {
  return cached(`tencent-eventbridge:${s.id}`, () => ceb.listItems(s.tencent), { force });
}

export async function eventDetail(s: Session, item: EventBridgeItem): Promise<ResourceDetail> {
  if (isDemo()) return demo.eventBridgeDetail(s.id, item);
  return s.connection.vendor === "tencent" ? ceb.detail(s.tencent, item) : eb.detail(s.aws, item);
}

export async function parameterValue(s: Session, p: ssm.SSMParameter): Promise<string> {
  if (isDemo()) return demo.parameterValue(s.id, p.name);
  return ssm.parameterValue(s.aws, p, ssm.isSecure(p));
}
