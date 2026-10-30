// Cloud Resource Manager v1: the projects a credential can see. v1
// `projects.list` returns every project the caller has
// resourcemanager.projects.get on (roles/browser and up).

import type { GoogleCredentials } from "./auth.ts";
import { collectPages, gcpRequest } from "./request.ts";

const BASE = "https://cloudresourcemanager.googleapis.com/v1";

export interface GcpProject {
  projectId: string;
  projectNumber: string;
  name?: string;
  lifecycleState?: "ACTIVE" | "DELETE_REQUESTED" | "DELETE_IN_PROGRESS" | "LIFECYCLE_STATE_UNSPECIFIED";
  createTime?: string;
  labels?: Record<string, string>;
  parent?: { type: string; id: string };
}

interface ListProjectsResponse {
  projects?: GcpProject[];
  nextPageToken?: string;
}

export async function listProjects(
  creds: GoogleCredentials,
  opts: { activeOnly?: boolean } = {}
): Promise<GcpProject[]> {
  const activeOnly = opts.activeOnly ?? true;
  const projects = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListProjectsResponse>(creds, `${BASE}/projects`, {
      query: { pageToken, pageSize: 500, filter: activeOnly ? "lifecycleState:ACTIVE" : undefined },
    });
    return { items: r.projects ?? [], nextPageToken: r.nextPageToken };
  });
  return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

export function getProject(creds: GoogleCredentials, projectId: string): Promise<GcpProject> {
  return gcpRequest<GcpProject>(creds, `${BASE}/projects/${encodeURIComponent(projectId)}`);
}
