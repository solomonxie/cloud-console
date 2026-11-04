import type { RunReadiness } from "@cloud-console/core/gcp/run";

const GCE_STATUS: Record<string, string> = { RUNNING: "Running", TERMINATED: "Stopped", STOPPING: "Stopping", PROVISIONING: "Starting", STAGING: "Starting", SUSPENDED: "Suspended", REPAIRING: "Repairing" };

export const gceStatus = (s: string) => GCE_STATUS[s] ?? s.charAt(0) + s.slice(1).toLowerCase();

export const READY: Record<RunReadiness, string> = { ready: "Ready", failed: "Failed", pending: "Deploying" };
