// Compute Engine v1: VM instances and instance groups across all zones and
// regions of a project, via aggregatedList (one paginated call instead of
// one per zone).

import type { GoogleCredentials } from "./auth.ts";
import { collectPages, gcpRequest, lastSegment } from "./request.ts";

const BASE = "https://compute.googleapis.com/compute/v1";

function projectBase(project: string): string {
  return `${BASE}/projects/${encodeURIComponent(project)}`;
}

// ---------------------------------------------------------------------------
// Types (only the fields the UI uses; the API returns more).

export type InstanceStatus =
  | "PROVISIONING"
  | "STAGING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "SUSPENDING"
  | "SUSPENDED"
  | "REPAIRING"
  | "TERMINATED";

export interface AccessConfig {
  type?: string;
  name?: string;
  natIP?: string;
  networkTier?: string;
}

export interface NetworkInterface {
  name?: string;
  network?: string;
  subnetwork?: string;
  networkIP?: string;
  accessConfigs?: AccessConfig[];
}

export interface AttachedDisk {
  deviceName?: string;
  source?: string;
  boot?: boolean;
  diskSizeGb?: string;
  mode?: string;
  type?: string;
}

export interface Instance {
  id: string;
  name: string;
  zone: string; // URL as returned by the API
  machineType: string; // URL
  status: InstanceStatus;
  statusMessage?: string;
  description?: string;
  creationTimestamp?: string;
  lastStartTimestamp?: string;
  lastStopTimestamp?: string;
  cpuPlatform?: string;
  networkInterfaces?: NetworkInterface[];
  disks?: AttachedDisk[];
  labels?: Record<string, string>;
  tags?: { items?: string[] };
  serviceAccounts?: { email: string; scopes?: string[] }[];
  scheduling?: { preemptible?: boolean; provisioningModel?: string; automaticRestart?: boolean };
  deletionProtection?: boolean;
  selfLink: string;
}

// An instance flattened out of aggregatedList with convenience fields.
export interface InstanceSummary extends Instance {
  zoneName: string; // "us-central1-a"
  machineTypeName: string; // "e2-medium"
  internalIp?: string;
  externalIp?: string;
}

export interface Operation {
  id: string;
  name: string;
  operationType?: string;
  status: "PENDING" | "RUNNING" | "DONE";
  targetLink?: string;
  zone?: string;
  progress?: number;
  error?: { errors?: { code?: string; message?: string }[] };
  selfLink?: string;
}

export interface InstanceGroup {
  id: string;
  name: string;
  description?: string;
  size?: number;
  zone?: string; // zonal groups
  region?: string; // regional groups
  network?: string;
  subnetwork?: string;
  namedPorts?: { name: string; port: number }[];
  creationTimestamp?: string;
  selfLink: string;
}

export interface InstanceGroupManager {
  id: string;
  name: string;
  baseInstanceName?: string;
  instanceGroup: string; // URL of the underlying InstanceGroup
  instanceTemplate?: string;
  targetSize?: number;
  zone?: string;
  region?: string;
  status?: { isStable?: boolean };
  currentActions?: Record<string, number>;
  selfLink: string;
}

export interface InstanceGroupSummary extends InstanceGroup {
  managed: boolean;
  location: string; // zone or region name
  locationType: "zone" | "region";
  manager?: InstanceGroupManager;
}

export interface GroupMember {
  instance: string; // URL
  name: string;
  status?: string;
  currentAction?: string; // managed only, e.g. "NONE", "CREATING"
}

// ---------------------------------------------------------------------------
// aggregatedList flattening.

interface AggregatedScope {
  warning?: { code?: string; message?: string };
  [key: string]: unknown;
}

interface AggregatedListResponse {
  items?: Record<string, AggregatedScope>;
  nextPageToken?: string;
  unreachables?: string[];
}

// aggregatedList returns `items` keyed by scope ("zones/us-central1-a",
// "regions/us-central1"), each holding `{ <field>: [...] }` or, for scopes
// with nothing in them, `{ warning: { code: "NO_RESULTS_ON_PAGE" } }`.
export function flattenAggregated<T>(response: AggregatedListResponse, field: string): { scope: string; item: T }[] {
  const out: { scope: string; item: T }[] = [];
  for (const [scope, value] of Object.entries(response.items ?? {})) {
    const list = value[field];
    if (Array.isArray(list)) for (const item of list as T[]) out.push({ scope, item });
  }
  return out;
}

async function aggregatedList<T>(
  creds: GoogleCredentials,
  project: string,
  resource: string,
  field: string
): Promise<{ scope: string; item: T }[]> {
  return collectPages(async (pageToken) => {
    const r = await gcpRequest<AggregatedListResponse>(creds, `${projectBase(project)}/aggregated/${resource}`, {
      query: { pageToken, maxResults: 500, returnPartialSuccess: true },
    });
    return { items: flattenAggregated<T>(r, field), nextPageToken: r.nextPageToken };
  });
}

// ---------------------------------------------------------------------------
// Instances.

export function summarizeInstance(inst: Instance): InstanceSummary {
  const nic = inst.networkInterfaces?.[0];
  const externalIp = inst.networkInterfaces
    ?.flatMap((n) => n.accessConfigs ?? [])
    .find((a) => a.natIP)?.natIP;
  return {
    ...inst,
    zoneName: lastSegment(inst.zone),
    machineTypeName: lastSegment(inst.machineType),
    internalIp: nic?.networkIP,
    externalIp,
  };
}

export async function listInstances(creds: GoogleCredentials, project: string): Promise<InstanceSummary[]> {
  const rows = await aggregatedList<Instance>(creds, project, "instances", "instances");
  return rows
    .map((r) => summarizeInstance(r.item))
    .sort((a, b) => a.name.localeCompare(b.name) || a.zoneName.localeCompare(b.zoneName));
}

function instanceUrl(project: string, zone: string, name: string): string {
  return `${projectBase(project)}/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(name)}`;
}

export async function getInstance(
  creds: GoogleCredentials,
  project: string,
  zone: string,
  name: string
): Promise<InstanceSummary> {
  return summarizeInstance(await gcpRequest<Instance>(creds, instanceUrl(project, zone, name)));
}

export type InstanceAction = "start" | "stop" | "reset";

export function instanceAction(
  creds: GoogleCredentials,
  project: string,
  zone: string,
  name: string,
  action: InstanceAction
): Promise<Operation> {
  return gcpRequest<Operation>(creds, `${instanceUrl(project, zone, name)}/${action}`, { method: "POST" });
}

export const startInstance = (c: GoogleCredentials, p: string, z: string, n: string) => instanceAction(c, p, z, n, "start");
export const stopInstance = (c: GoogleCredentials, p: string, z: string, n: string) => instanceAction(c, p, z, n, "stop");
export const resetInstance = (c: GoogleCredentials, p: string, z: string, n: string) => instanceAction(c, p, z, n, "reset");

export function getZoneOperation(
  creds: GoogleCredentials,
  project: string,
  zone: string,
  operation: string
): Promise<Operation> {
  return gcpRequest<Operation>(
    creds,
    `${projectBase(project)}/zones/${encodeURIComponent(zone)}/operations/${encodeURIComponent(operation)}`
  );
}

export interface SerialPortOutput {
  contents: string;
  start: string;
  next: string;
}

// Serial console output (needs compute.instances.getSerialPortOutput —
// in compute.instanceAdmin.v1, not compute.viewer). Pass `start` = the
// previous call's `next` to tail.
export function getSerialPortOutput(
  creds: GoogleCredentials,
  project: string,
  zone: string,
  name: string,
  opts: { port?: number; start?: string } = {}
): Promise<SerialPortOutput> {
  return gcpRequest<SerialPortOutput>(creds, `${instanceUrl(project, zone, name)}/serialPort`, {
    query: { port: opts.port ?? 1, start: opts.start },
  });
}

// ---------------------------------------------------------------------------
// Instance groups.

function scopeLocation(scope: string): { location: string; locationType: "zone" | "region" } {
  const [kind, name] = scope.split("/");
  return { location: name ?? scope, locationType: kind === "regions" ? "region" : "zone" };
}

// Every instance group, managed or not: instanceGroups.aggregatedList returns
// both (a MIG owns an underlying instance group), and instanceGroupManagers
// tells us which ones are managed.
export async function listInstanceGroups(
  creds: GoogleCredentials,
  project: string
): Promise<InstanceGroupSummary[]> {
  const [groups, managers] = await Promise.all([
    aggregatedList<InstanceGroup>(creds, project, "instanceGroups", "instanceGroups"),
    aggregatedList<InstanceGroupManager>(creds, project, "instanceGroupManagers", "instanceGroupManagers"),
  ]);
  const managerByGroup = new Map(managers.map((m) => [m.item.instanceGroup, m.item]));
  return groups
    .map(({ scope, item }) => {
      const manager = managerByGroup.get(item.selfLink);
      return { ...item, ...scopeLocation(scope), managed: !!manager, manager };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface ListGroupInstancesResponse {
  items?: { instance: string; status?: string }[];
  nextPageToken?: string;
}

interface ListManagedInstancesResponse {
  managedInstances?: { instance: string; instanceStatus?: string; currentAction?: string; id?: string }[];
  nextPageToken?: string;
}

function locationPath(group: Pick<InstanceGroupSummary, "location" | "locationType">): string {
  return `${group.locationType === "region" ? "regions" : "zones"}/${encodeURIComponent(group.location)}`;
}

// Members of a group. Managed groups go through the manager (which also
// reports in-progress actions like CREATING/RECREATING); unmanaged ones
// through the group's own listInstances.
export async function listGroupInstances(
  creds: GoogleCredentials,
  project: string,
  group: Pick<InstanceGroupSummary, "name" | "location" | "locationType" | "managed"> & {
    manager?: Pick<InstanceGroupManager, "name">;
  }
): Promise<GroupMember[]> {
  const base = `${projectBase(project)}/${locationPath(group)}`;
  if (group.managed) {
    const managerName = group.manager?.name ?? group.name;
    return collectPages(async (pageToken) => {
      const r = await gcpRequest<ListManagedInstancesResponse>(
        creds,
        `${base}/instanceGroupManagers/${encodeURIComponent(managerName)}/listManagedInstances`,
        { method: "POST", query: { pageToken, maxResults: 500 } }
      );
      return {
        items: (r.managedInstances ?? []).map((m) => ({
          instance: m.instance,
          name: lastSegment(m.instance),
          status: m.instanceStatus,
          currentAction: m.currentAction,
        })),
        nextPageToken: r.nextPageToken,
      };
    });
  }
  return collectPages(async (pageToken) => {
    const r = await gcpRequest<ListGroupInstancesResponse>(
      creds,
      `${base}/instanceGroups/${encodeURIComponent(group.name)}/listInstances`,
      { method: "POST", query: { pageToken, maxResults: 500 }, body: { instanceState: "ALL" } }
    );
    return {
      items: (r.items ?? []).map((i) => ({ instance: i.instance, name: lastSegment(i.instance), status: i.status })),
      nextPageToken: r.nextPageToken,
    };
  });
}

// Zone of a member instance from its URL ("…/zones/us-central1-a/instances/x").
export function zoneOfInstanceUrl(url: string): string {
  const m = /\/zones\/([^/]+)\//.exec(url);
  return m?.[1] ?? "";
}
