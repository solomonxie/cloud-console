import type { GoogleCredentials } from "@cloud-console/core/gcp/auth";

export interface ViewContext {
  creds: GoogleCredentials;
  projectId: string;
  // Set by the shell; a view checks it after each await so a stale response
  // (project switched meanwhile) doesn't render.
  isCurrent: () => boolean;
}
