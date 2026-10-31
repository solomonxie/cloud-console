import { afterEach, expect, test, vi } from "vitest";
import { clearTokenCache, type ServiceAccountKey } from "../src/gcp/auth.ts";
import { listExecutions, listJobs, listRevisions, listServices, regionOf, runJob } from "../src/gcp/run.ts";
import { apiCalls, fixtureJson, mockFetch } from "./gcp-helpers.ts";

const sa = fixtureJson<ServiceAccountKey>("service-account.json");
const WEB = "projects/demo-project-123/locations/us-central1/services/web";
const JOB = "projects/demo-project-123/locations/us-central1/jobs/nightly-export";

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokenCache();
});

test("listServices lists every region via locations/-, follows pages and derives id, region and readiness", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/v2/projects/demo-project-123/locations/-/services"
      ? { fixture: url.searchParams.get("pageToken") === "run-services-page-2" ? "run-services-page2.json" : "run-services-page1.json" }
      : undefined
  );
  const services = await listServices(sa, "demo-project-123");
  expect(services.map((s) => [s.serviceId, s.region, s.ready])).toEqual([
    ["api", "europe-west1", "failed"],
    ["web", "us-central1", "ready"],
    ["worker", "us-central1", "pending"],
  ]);
  expect(apiCalls(calls)).toHaveLength(2);
});

test("listRevisions reads Ready from conditions and sorts newest first", async () => {
  mockFetch(({ url }) => (url.pathname === `/v2/${WEB}/revisions` ? { fixture: "run-revisions.json" } : undefined));
  const revisions = await listRevisions(sa, WEB);
  expect(revisions.map((r) => [r.revisionId, r.ready])).toEqual([
    ["web-00042-xyz", "ready"],
    ["web-00041-abc", "ready"],
  ]);
});

test("listJobs derives id and region", async () => {
  mockFetch(({ url }) => (url.pathname === "/v2/projects/demo-project-123/locations/-/jobs" ? { fixture: "run-jobs.json" } : undefined));
  const jobs = await listJobs(sa, "demo-project-123");
  expect(jobs.map((j) => [j.jobId, j.region, j.ready, j.executionCount])).toEqual([["nightly-export", "us-central1", "ready", 512]]);
});

test("listExecutions sorts newest first and classifies running, succeeded and failed", async () => {
  const calls = mockFetch(({ url }) => (url.pathname === `/v2/${JOB}/executions` ? { fixture: "run-executions.json" } : undefined));
  const executions = await listExecutions(sa, JOB);
  expect(executions.map((e) => [e.executionId, e.status])).toEqual([
    ["nightly-export-zz9q1", "running"],
    ["nightly-export-k2p9x", "succeeded"],
    ["nightly-export-a1b2c", "failed"],
  ]);
  expect(apiCalls(calls)[0]!.url.searchParams.get("pageSize")).toBe("20");
});

test("runJob POSTs to the job's :run method", async () => {
  const calls = mockFetch(({ url, method }) =>
    method === "POST" && url.pathname === `/v2/${JOB}:run` ? { fixture: "run-job-run-operation.json" } : undefined
  );
  const op = await runJob(sa, JOB);
  expect(op.metadata?.name).toBe(`${JOB}/executions/nightly-export-n3w01`);
  expect(apiCalls(calls)).toHaveLength(1);
});

test("regionOf reads the location segment", () => {
  expect(regionOf(WEB)).toBe("us-central1");
  expect(regionOf("not-a-name")).toBe("");
});
