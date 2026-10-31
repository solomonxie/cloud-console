// Cloud Monitoring v3: an instance's recent usage (CPU, memory, network,
// disk) as one aligned series per metric. Needs monitoring.timeSeries.list
// (roles/monitoring.viewer). Memory only exists when the Ops Agent runs on
// the VM; without it the series is simply empty.

import type { GoogleCredentials } from "./auth.ts";
import { gcpRequest } from "./request.ts";

const BASE = "https://monitoring.googleapis.com/v3";

export interface MetricPoint {
  time: number; // epoch ms
  value: number;
}

export interface InstanceMetric {
  id: "cpu" | "memory" | "networkIn" | "networkOut" | "diskRead" | "diskWrite";
  type: string;
  unit: "percent" | "bytesPerSecond";
  // Extra filter clause, e.g. memory's state label.
  extraFilter?: string;
  aligner: "ALIGN_MEAN" | "ALIGN_RATE";
  reducer: "REDUCE_MEAN" | "REDUCE_SUM";
}

// Per-NIC / per-disk series are summed into one; percentages are averaged.
export const INSTANCE_METRICS: InstanceMetric[] = [
  { id: "cpu", type: "compute.googleapis.com/instance/cpu/utilization", unit: "percent", aligner: "ALIGN_MEAN", reducer: "REDUCE_MEAN" },
  {
    id: "memory",
    type: "agent.googleapis.com/memory/percent_used",
    unit: "percent",
    extraFilter: 'metric.labels.state = "used"',
    aligner: "ALIGN_MEAN",
    reducer: "REDUCE_MEAN",
  },
  { id: "networkIn", type: "compute.googleapis.com/instance/network/received_bytes_count", unit: "bytesPerSecond", aligner: "ALIGN_RATE", reducer: "REDUCE_SUM" },
  { id: "networkOut", type: "compute.googleapis.com/instance/network/sent_bytes_count", unit: "bytesPerSecond", aligner: "ALIGN_RATE", reducer: "REDUCE_SUM" },
  { id: "diskRead", type: "compute.googleapis.com/instance/disk/read_bytes_count", unit: "bytesPerSecond", aligner: "ALIGN_RATE", reducer: "REDUCE_SUM" },
  { id: "diskWrite", type: "compute.googleapis.com/instance/disk/write_bytes_count", unit: "bytesPerSecond", aligner: "ALIGN_RATE", reducer: "REDUCE_SUM" },
];

interface TimeSeriesResponse {
  timeSeries?: {
    points?: { interval: { endTime: string }; value: { doubleValue?: number; int64Value?: string } }[];
  }[];
}

// One metric for one instance over the last `minutes`, oldest point first.
// CPU utilization comes back as 0–1 and is scaled to 0–100 like memory.
export async function instanceMetricSeries(
  creds: GoogleCredentials,
  project: string,
  instanceId: string,
  metric: InstanceMetric,
  opts: { minutes?: number; alignSeconds?: number; now?: number } = {}
): Promise<MetricPoint[]> {
  const minutes = opts.minutes ?? 360;
  const end = opts.now ?? Date.now();
  const filter = [
    `metric.type = "${metric.type}"`,
    'resource.type = "gce_instance"',
    `resource.labels.instance_id = "${instanceId}"`,
    metric.extraFilter,
  ]
    .filter(Boolean)
    .join(" AND ");
  const r = await gcpRequest<TimeSeriesResponse>(creds, `${BASE}/projects/${encodeURIComponent(project)}/timeSeries`, {
    query: {
      filter,
      "interval.startTime": new Date(end - minutes * 60_000).toISOString(),
      "interval.endTime": new Date(end).toISOString(),
      "aggregation.alignmentPeriod": `${opts.alignSeconds ?? 300}s`,
      "aggregation.perSeriesAligner": metric.aligner,
      "aggregation.crossSeriesReducer": metric.reducer,
    },
  });
  const scale = metric.id === "cpu" ? 100 : 1;
  return (r.timeSeries?.[0]?.points ?? [])
    .map((p) => ({
      time: Date.parse(p.interval.endTime),
      value: (p.value.doubleValue ?? Number(p.value.int64Value ?? 0)) * scale,
    }))
    .sort((a, b) => a.time - b.time);
}
