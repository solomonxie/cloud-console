import { afterEach, expect, test, vi } from "vitest";
import { clearTokenCache, type ServiceAccountKey } from "../src/gcp/auth.ts";
import {
  flattenAggregated,
  instanceAction,
  listGroupInstances,
  listInstanceGroups,
  listInstances,
} from "../src/gcp/compute.ts";
import { listProjects } from "../src/gcp/projects.ts";
import { GcpApiError } from "../src/gcp/request.ts";
import { accessSecretVersion, listSecrets, listSecretVersions } from "../src/gcp/secrets.ts";
import { apiCalls, fixtureJson, mockFetch } from "./gcp-helpers.ts";

const sa = fixtureJson<ServiceAccountKey>("service-account.json");

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokenCache();
});

test("listProjects follows nextPageToken and sorts by projectId", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/v1/projects"
      ? { fixture: url.searchParams.get("pageToken") === "page-2-token" ? "projects-page2.json" : "projects-page1.json" }
      : undefined
  );
  const projects = await listProjects(sa);
  expect(projects.map((p) => p.projectId)).toEqual(["demo-project-123", "zeta-prod"]);
  const api = apiCalls(calls);
  expect(api).toHaveLength(2);
  expect(api[0]!.url.searchParams.get("filter")).toBe("lifecycleState:ACTIVE");
  expect(api[0]!.headers.Authorization).toBe("Bearer ya29.fake-access-token");
});

test("listInstances flattens aggregatedList across zones and pages", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/compute/v1/projects/demo-project-123/aggregated/instances"
      ? { fixture: url.searchParams.get("pageToken") === "agg-page-2" ? "instances-aggregated-page2.json" : "instances-aggregated-page1.json" }
      : undefined
  );
  const instances = await listInstances(sa, "demo-project-123");
  expect(apiCalls(calls)).toHaveLength(2);
  expect(
    instances.map((i) => [i.name, i.zoneName, i.status, i.machineTypeName, i.internalIp, i.externalIp])
  ).toEqual([
    ["batch-worker", "europe-west1-b", "TERMINATED", "n2-standard-4", "10.132.0.5", undefined],
    ["web-1", "us-central1-a", "RUNNING", "e2-medium", "10.128.0.2", "34.123.45.67"],
  ]);
});

test("flattenAggregated skips NO_RESULTS_ON_PAGE scopes", () => {
  const rows = flattenAggregated(fixtureJson("instance-groups-aggregated.json"), "instanceGroups");
  expect(rows.map((r) => r.scope)).toEqual(["zones/us-central1-a", "regions/us-central1"]);
});

test("listInstanceGroups marks managed groups and their location", async () => {
  mockFetch(({ url }) => {
    if (url.pathname.endsWith("/aggregated/instanceGroups")) return { fixture: "instance-groups-aggregated.json" };
    if (url.pathname.endsWith("/aggregated/instanceGroupManagers")) return { fixture: "instance-group-managers-aggregated.json" };
    return undefined;
  });
  const groups = await listInstanceGroups(sa, "demo-project-123");
  expect(groups.map((g) => [g.name, g.managed, g.locationType, g.location, g.size, g.manager?.targetSize])).toEqual([
    ["api-mig", true, "region", "us-central1", 3, 3],
    ["legacy-pool", false, "zone", "us-central1-a", 2, undefined],
  ]);
});

test("listGroupInstances uses listManagedInstances for MIGs and listInstances otherwise", async () => {
  const calls = mockFetch(({ url, method }) => {
    if (method !== "POST") return undefined;
    if (url.pathname.endsWith("/regions/us-central1/instanceGroupManagers/api-mig/listManagedInstances")) {
      return { fixture: "managed-instances.json" };
    }
    if (url.pathname.endsWith("/zones/us-central1-a/instanceGroups/legacy-pool/listInstances")) {
      return { fixture: "group-instances.json" };
    }
    return undefined;
  });
  const managed = await listGroupInstances(sa, "demo-project-123", {
    name: "api-mig", location: "us-central1", locationType: "region", managed: true,
  });
  expect(managed.map((m) => [m.name, m.status, m.currentAction])).toEqual([
    ["api-x1b2", "RUNNING", "NONE"],
    ["api-k9z8", "RUNNING", "NONE"],
    ["api-q4w5", undefined, "CREATING"],
  ]);
  const unmanaged = await listGroupInstances(sa, "demo-project-123", {
    name: "legacy-pool", location: "us-central1-a", locationType: "zone", managed: false,
  });
  expect(unmanaged.map((m) => [m.name, m.status])).toEqual([
    ["legacy-a", "RUNNING"],
    ["legacy-b", "TERMINATED"],
  ]);
  const unmanagedCall = apiCalls(calls).at(-1)!;
  expect(JSON.parse(unmanagedCall.body!)).toEqual({ instanceState: "ALL" });
});

test("instanceAction POSTs to the instance's action URL and returns the operation", async () => {
  const calls = mockFetch(({ url, method }) =>
    method === "POST" && url.pathname === "/compute/v1/projects/demo-project-123/zones/us-central1-a/instances/web-1/stop"
      ? { fixture: "instance-stop-operation.json" }
      : undefined
  );
  const op = await instanceAction(sa, "demo-project-123", "us-central1-a", "web-1", "stop");
  expect(op.operationType).toBe("stop");
  expect(op.status).toBe("RUNNING");
  expect(apiCalls(calls)).toHaveLength(1);
});

test("listSecrets paginates and derives secretId", async () => {
  mockFetch(({ url }) =>
    url.pathname === "/v1/projects/demo-project-123/secrets"
      ? { fixture: url.searchParams.get("pageToken") === "secrets-page-2" ? "secrets-page2.json" : "secrets-page1.json" }
      : undefined
  );
  const secrets = await listSecrets(sa, "demo-project-123");
  expect(secrets.map((s) => s.secretId)).toEqual(["db-password", "stripe-key"]);
});

test("listSecretVersions sorts newest first", async () => {
  mockFetch(({ url }) =>
    url.pathname === "/v1/projects/demo-project-123/secrets/db-password/versions" ? { fixture: "secret-versions.json" } : undefined
  );
  const versions = await listSecretVersions(sa, "demo-project-123", "db-password");
  expect(versions.map((v) => [v.version, v.state])).toEqual([
    ["3", "ENABLED"],
    ["2", "DISABLED"],
    ["1", "DESTROYED"],
  ]);
});

test("accessSecretVersion decodes a UTF-8 text payload", async () => {
  mockFetch(({ url }) =>
    url.pathname === "/v1/projects/demo-project-123/secrets/db-password/versions/latest:access"
      ? { fixture: "secret-access-text.json" }
      : undefined
  );
  const payload = await accessSecretVersion(sa, "demo-project-123", "db-password");
  expect(payload.name).toBe("projects/222222222222/secrets/db-password/versions/3");
  expect(payload.isBinary).toBe(false);
  expect(payload.text).toBe("hunter2 — pässwörd\n");
});

test("accessSecretVersion flags a binary payload", async () => {
  mockFetch(() => ({ fixture: "secret-access-binary.json" }));
  const payload = await accessSecretVersion(sa, "demo-project-123", "tls-keystore", "1");
  expect(payload.isBinary).toBe(true);
  expect(payload.text).toBeNull();
  expect([...payload.bytes]).toEqual([0, 1, 2, 0xff, 0xfe, 0x50, 0x4e, 0x47]);
});

test("a 403 surfaces Google's message as a GcpApiError", async () => {
  mockFetch(() => ({ status: 403, fixture: "error-403-secret-access.json" }));
  const err = await accessSecretVersion(sa, "demo-project-123", "db-password").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(GcpApiError);
  const apiErr = err as GcpApiError;
  expect(apiErr.isPermissionDenied).toBe(true);
  expect(apiErr.status).toBe("PERMISSION_DENIED");
  expect(apiErr.reason).toBe("IAM_PERMISSION_DENIED");
  expect(apiErr.message).toMatch(/secretmanager\.versions\.access/);
});
