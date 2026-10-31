// Session-only, in-memory caches so moving between screens doesn't refetch
// the same lists. Nothing here is persisted; credentials never enter a key.

import { listInstances, type InstanceSummary } from "@cloud-console/core/gcp/compute";
import { listProjects, type GcpProject } from "@cloud-console/core/gcp/projects";
import type { GoogleCredentials } from "@cloud-console/core/gcp/auth";
import type { ProjectContext } from "./context.ts";

const projects = new Map<string, Promise<GcpProject[]>>();
const instances = new Map<string, Promise<InstanceSummary[]>>();

function remember<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) {
    p = load();
    map.set(key, p);
    // A failure isn't cached — the next screen tries again.
    p.catch(() => {
      if (map.get(key) === p) map.delete(key);
    });
  }
  return p;
}

export function cachedProjects(accountId: string, creds: GoogleCredentials): Promise<GcpProject[]> {
  return remember(projects, accountId, () => listProjects(creds));
}

export function cachedInstances(ctx: ProjectContext, fresh = false): Promise<InstanceSummary[]> {
  const key = `${ctx.accountId}\n${ctx.projectId}`;
  if (fresh) instances.delete(key);
  return remember(instances, key, () => listInstances(ctx.creds, ctx.projectId));
}

// After an account is edited or deleted.
export function forgetAccount(accountId: string): void {
  projects.delete(accountId);
  for (const key of instances.keys()) if (key.startsWith(`${accountId}\n`)) instances.delete(key);
}
