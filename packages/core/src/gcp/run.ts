// Cloud Run Admin API v2: services, their revisions, and jobs with their
// executions, across every region of a project (locations/- lists all
// regions in one paginated call). Read-only except running a job.
// Listing needs run.services.list / run.jobs.list (roles/run.viewer);
// running a job needs run.jobs.run (roles/run.developer).

import type { GoogleCredentials } from "./auth.ts";
import { collectPages, gcpRequest, lastSegment } from "./request.ts";

const BASE = "https://run.googleapis.com/v2";

export interface RunCondition {
  type: string;
  state?: "CONDITION_SUCCEEDED" | "CONDITION_FAILED" | "CONDITION_RECONCILING" | "CONDITION_PENDING" | string;
  message?: string;
  lastTransitionTime?: string;
  reason?: string;
}

export interface RunContainer {
  image: string;
  name?: string;
  ports?: { containerPort?: number; name?: string }[];
  resources?: { limits?: Record<string, string>; cpuIdle?: boolean };
  env?: { name: string; value?: string; valueSource?: { secretKeyRef?: { secret: string; version?: string } } }[];
}

export interface RunTemplate {
  revision?: string;
  serviceAccount?: string;
  timeout?: string; // "300s"
  maxInstanceRequestConcurrency?: number;
  scaling?: { minInstanceCount?: number; maxInstanceCount?: number };
  containers?: RunContainer[];
  vpcAccess?: { connector?: string; egress?: string };
  executionEnvironment?: string;
}

export interface RunTrafficStatus {
  type?: string; // "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" | "…_REVISION"
  revision?: string;
  percent?: number;
  tag?: string;
  uri?: string;
}

export interface RunService {
  name: string; // "projects/p/locations/us-central1/services/api"
  uid?: string;
  description?: string;
  uri?: string;
  urls?: string[];
  creator?: string;
  lastModifier?: string;
  createTime?: string;
  updateTime?: string;
  labels?: Record<string, string>;
  ingress?: string; // "INGRESS_TRAFFIC_ALL" | "…_INTERNAL_ONLY" | "…_INTERNAL_LOAD_BALANCER"
  invokerIamDisabled?: boolean;
  template?: RunTemplate;
  terminalCondition?: RunCondition;
  conditions?: RunCondition[];
  latestReadyRevision?: string;
  latestCreatedRevision?: string;
  trafficStatuses?: RunTrafficStatus[];
  reconciling?: boolean;
}

export interface RunServiceSummary extends RunService {
  serviceId: string; // "api"
  region: string; // "us-central1"
  ready: RunReadiness;
}

export type RunReadiness = "ready" | "failed" | "pending";

export interface RunRevision {
  name: string;
  createTime?: string;
  containers?: RunContainer[];
  scaling?: { minInstanceCount?: number; maxInstanceCount?: number };
  conditions?: RunCondition[];
  serviceAccount?: string;
  maxInstanceRequestConcurrency?: number;
  timeout?: string;
}

export interface RunRevisionSummary extends RunRevision {
  revisionId: string;
  ready: RunReadiness;
}

export interface RunJob {
  name: string;
  createTime?: string;
  updateTime?: string;
  creator?: string;
  labels?: Record<string, string>;
  template?: {
    taskCount?: number;
    parallelism?: number;
    template?: { containers?: RunContainer[]; timeout?: string; maxRetries?: number; serviceAccount?: string };
  };
  terminalCondition?: RunCondition;
  latestCreatedExecution?: { name?: string; createTime?: string; completionTime?: string; completionStatus?: string };
  executionCount?: number;
  reconciling?: boolean;
}

export interface RunJobSummary extends RunJob {
  jobId: string;
  region: string;
  ready: RunReadiness;
}

export interface RunExecution {
  name: string;
  createTime?: string;
  startTime?: string;
  completionTime?: string;
  taskCount?: number;
  runningCount?: number;
  succeededCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  conditions?: RunCondition[];
  logUri?: string;
}

export interface RunExecutionSummary extends RunExecution {
  executionId: string;
  status: "succeeded" | "failed" | "running" | "cancelled";
}

// "projects/p/locations/us-central1/services/api" → "us-central1"
export function regionOf(name: string): string {
  return /\/locations\/([^/]+)\//.exec(name)?.[1] ?? "";
}

// A resource's Ready condition (terminalCondition on services/jobs).
export function readiness(condition: RunCondition | undefined): RunReadiness {
  if (condition?.state === "CONDITION_SUCCEEDED") return "ready";
  if (condition?.state === "CONDITION_FAILED") return "failed";
  return "pending";
}

function readyCondition(conditions: RunCondition[] | undefined): RunCondition | undefined {
  return conditions?.find((c) => c.type === "Ready");
}

export function executionStatus(e: RunExecution): RunExecutionSummary["status"] {
  if (!e.completionTime) return "running";
  if ((e.cancelledCount ?? 0) > 0) return "cancelled";
  if ((e.failedCount ?? 0) > 0) return "failed";
  const completed = e.conditions?.find((c) => c.type === "Completed");
  return completed?.state === "CONDITION_FAILED" ? "failed" : "succeeded";
}

function locationsAll(project: string): string {
  return `${BASE}/projects/${encodeURIComponent(project)}/locations/-`;
}

interface ListServicesResponse {
  services?: RunService[];
  nextPageToken?: string;
  unreachable?: string[];
}

export async function listServices(creds: GoogleCredentials, project: string): Promise<RunServiceSummary[]> {
  const services = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListServicesResponse>(creds, `${locationsAll(project)}/services`, {
      query: { pageToken, pageSize: 500 },
    });
    return { items: r.services ?? [], nextPageToken: r.nextPageToken };
  });
  return services
    .map((s) => ({ ...s, serviceId: lastSegment(s.name), region: regionOf(s.name), ready: readiness(s.terminalCondition) }))
    .sort((a, b) => a.serviceId.localeCompare(b.serviceId) || a.region.localeCompare(b.region));
}

export function getService(creds: GoogleCredentials, name: string): Promise<RunService> {
  return gcpRequest<RunService>(creds, `${BASE}/${name}`);
}

interface ListRevisionsResponse {
  revisions?: RunRevision[];
  nextPageToken?: string;
}

// Newest first.
export async function listRevisions(creds: GoogleCredentials, serviceName: string): Promise<RunRevisionSummary[]> {
  const revisions = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListRevisionsResponse>(creds, `${BASE}/${serviceName}/revisions`, {
      query: { pageToken, pageSize: 100 },
    });
    return { items: r.revisions ?? [], nextPageToken: r.nextPageToken };
  }, 5);
  return revisions
    .map((r) => ({ ...r, revisionId: lastSegment(r.name), ready: readiness(readyCondition(r.conditions)) }))
    .sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""));
}

interface ListJobsResponse {
  jobs?: RunJob[];
  nextPageToken?: string;
}

export async function listJobs(creds: GoogleCredentials, project: string): Promise<RunJobSummary[]> {
  const jobs = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListJobsResponse>(creds, `${locationsAll(project)}/jobs`, {
      query: { pageToken, pageSize: 500 },
    });
    return { items: r.jobs ?? [], nextPageToken: r.nextPageToken };
  });
  return jobs
    .map((j) => ({ ...j, jobId: lastSegment(j.name), region: regionOf(j.name), ready: readiness(j.terminalCondition) }))
    .sort((a, b) => a.jobId.localeCompare(b.jobId) || a.region.localeCompare(b.region));
}

interface ListExecutionsResponse {
  executions?: RunExecution[];
  nextPageToken?: string;
}

// The most recent executions, newest first (one page is plenty for a panel).
export async function listExecutions(creds: GoogleCredentials, jobName: string, pageSize = 20): Promise<RunExecutionSummary[]> {
  const r = await gcpRequest<ListExecutionsResponse>(creds, `${BASE}/${jobName}/executions`, { query: { pageSize } });
  return (r.executions ?? [])
    .map((e) => ({ ...e, executionId: lastSegment(e.name), status: executionStatus(e) }))
    .sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""));
}

export interface RunOperation {
  name: string;
  done?: boolean;
  metadata?: { name?: string };
  error?: { code?: number; message?: string };
}

// Starts a new execution of the job with its saved configuration.
export function runJob(creds: GoogleCredentials, jobName: string): Promise<RunOperation> {
  return gcpRequest<RunOperation>(creds, `${BASE}/${jobName}:run`, { method: "POST", body: {} });
}
