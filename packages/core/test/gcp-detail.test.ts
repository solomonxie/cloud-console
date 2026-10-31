import { afterEach, expect, test, vi } from "vitest";
import { clearTokenCache, type ServiceAccountKey } from "../src/gcp/auth.ts";
import { listBuckets } from "../src/gcp/buckets.ts";
import { getDisk, getMachineType } from "../src/gcp/compute.ts";
import { INSTANCE_METRICS, instanceMetricSeries } from "../src/gcp/monitoring.ts";
import { apiCalls, fixtureJson, mockFetch } from "./gcp-helpers.ts";

const sa = fixtureJson<ServiceAccountKey>("service-account.json");
const metric = (id: string) => INSTANCE_METRICS.find((m) => m.id === id)!;

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokenCache();
});

test("getMachineType reads vCPUs and memory", async () => {
  mockFetch(({ url }) =>
    url.pathname === "/compute/v1/projects/demo-project-123/zones/us-central1-a/machineTypes/e2-medium"
      ? { fixture: "machine-type-e2-medium.json" }
      : undefined
  );
  const mt = await getMachineType(sa, "demo-project-123", "us-central1-a", "e2-medium");
  expect([mt.guestCpus, mt.memoryMb, mt.isSharedCpu]).toEqual([2, 4096, true]);
});

test("getDisk fetches an attached disk's source through compute.googleapis.com", async () => {
  const calls = mockFetch(({ url }) =>
    url.host === "compute.googleapis.com" && url.pathname === "/compute/v1/projects/demo-project-123/zones/us-central1-a/disks/web-1"
      ? { fixture: "disk-web-1.json" }
      : undefined
  );
  const disk = await getDisk(sa, "https://www.googleapis.com/compute/v1/projects/demo-project-123/zones/us-central1-a/disks/web-1");
  expect([disk.name, disk.typeName, disk.sizeGb, disk.status]).toEqual(["web-1", "pd-balanced", "10", "READY"]);
  expect(apiCalls(calls)).toHaveLength(1);
});

test("getDisk rejects a URL that isn't a disk", async () => {
  await expect(getDisk(sa, "https://example.com/nope")).rejects.toThrow("Not a disk URL");
});

test("instanceMetricSeries filters by instance, sorts oldest first and scales CPU to percent", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/v3/projects/demo-project-123/timeSeries" ? { fixture: "timeseries-cpu.json" } : undefined
  );
  const now = Date.parse("2026-10-30T12:10:00Z");
  const points = await instanceMetricSeries(sa, "demo-project-123", "4567890123456789012", metric("cpu"), { now });
  expect(points).toEqual([
    { time: Date.parse("2026-10-30T12:05:00Z"), value: 12.5 },
    { time: Date.parse("2026-10-30T12:10:00Z"), value: 42 },
  ]);
  const q = apiCalls(calls)[0]!.url.searchParams;
  expect(q.get("filter")).toBe(
    'metric.type = "compute.googleapis.com/instance/cpu/utilization" AND resource.type = "gce_instance" AND resource.labels.instance_id = "4567890123456789012"'
  );
  expect(q.get("interval.startTime")).toBe("2026-10-30T06:10:00.000Z");
  expect(q.get("aggregation.perSeriesAligner")).toBe("ALIGN_MEAN");
});

test("instanceMetricSeries reads int64 rates and sums across NICs", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/v3/projects/demo-project-123/timeSeries" ? { fixture: "timeseries-network-in.json" } : undefined
  );
  const points = await instanceMetricSeries(sa, "demo-project-123", "4567890123456789012", metric("networkIn"));
  expect(points.map((p) => p.value)).toEqual([2048]);
  const q = apiCalls(calls)[0]!.url.searchParams;
  expect([q.get("aggregation.perSeriesAligner"), q.get("aggregation.crossSeriesReducer")]).toEqual(["ALIGN_RATE", "REDUCE_SUM"]);
});

test("instanceMetricSeries returns no points when the metric has no data (no Ops Agent)", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/v3/projects/demo-project-123/timeSeries" ? { fixture: "timeseries-empty.json" } : undefined
  );
  const points = await instanceMetricSeries(sa, "demo-project-123", "4567890123456789012", metric("memory"));
  expect(points).toEqual([]);
  expect(apiCalls(calls)[0]!.url.searchParams.get("filter")).toContain('metric.labels.state = "used"');
});

test("listBuckets follows nextPageToken and sorts by name", async () => {
  const calls = mockFetch(({ url }) =>
    url.pathname === "/storage/v1/b"
      ? { fixture: url.searchParams.get("pageToken") === "buckets-page-2" ? "buckets-page2.json" : "buckets-page1.json" }
      : undefined
  );
  const buckets = await listBuckets(sa, "demo-project-123");
  expect(buckets.map((b) => [b.name, b.location])).toEqual([
    ["demo-assets", "US-CENTRAL1"],
    ["zeta-logs", "US"],
  ]);
  expect(apiCalls(calls)[0]!.url.searchParams.get("project")).toBe("demo-project-123");
});
