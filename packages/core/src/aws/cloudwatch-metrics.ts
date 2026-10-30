// CloudWatch metrics — Query API (form POST, XML), region-specific.
import type { AwsKey } from "./sigv4.ts";
import { awsFetch } from "./http.ts";
import { formEncode } from "./encoding.ts";
import { ancestor, walkXml } from "./xml.ts";

export interface MetricPoint {
  time: number; // epoch ms
  value: number;
}

/** One CloudWatch metric, or a SEARCH expression (first match wins). */
export interface MetricQuery {
  id: string;
  namespace: string;
  name: string;
  dimensions: Record<string, string>;
  stat?: string;
  search?: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function metricDataParams(queries: MetricQuery[], from: number, to: number, period: number): [string, string][] {
  const params: [string, string][] = [
    ["Action", "GetMetricData"],
    ["Version", "2010-08-01"],
    ["StartTime", iso(from)],
    ["EndTime", iso(to)],
    ["ScanBy", "TimestampAscending"],
  ];
  queries.forEach((query, i) => {
    const p = `MetricDataQueries.member.${i + 1}`;
    const stat = query.stat ?? "Average";
    params.push([`${p}.Id`, query.id]);
    if (query.search) {
      params.push([`${p}.Expression`, `SEARCH('${query.search}', '${stat}', ${period})`]);
    } else {
      params.push(
        [`${p}.MetricStat.Metric.Namespace`, query.namespace],
        [`${p}.MetricStat.Metric.MetricName`, query.name],
        [`${p}.MetricStat.Period`, String(period)],
        [`${p}.MetricStat.Stat`, stat]
      );
      Object.keys(query.dimensions)
        .sort()
        .forEach((name, j) => {
          params.push([`${p}.MetricStat.Metric.Dimensions.member.${j + 1}.Name`, name]);
          params.push([`${p}.MetricStat.Metric.Dimensions.member.${j + 1}.Value`, query.dimensions[name]!]);
        });
    }
  });
  return params;
}

export async function metricSeries(
  key: AwsKey,
  opts: { queries: MetricQuery[]; from: number; to: number; period: number; region: string }
): Promise<Record<string, MetricPoint[]>> {
  const body = metricDataParams(opts.queries, opts.from, opts.to, opts.period)
    .map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`)
    .join("&");
  const { text } = await awsFetch(key, {
    method: "POST",
    url: `https://monitoring.${opts.region}.amazonaws.com/`,
    region: opts.region,
    service: "monitoring",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
  });
  return parseMetricData(text);
}

export function parseMetricData(xml: string): Record<string, MetricPoint[]> {
  const result: Record<string, MetricPoint[]> = {};
  let id: string | undefined;
  let times: number[] = [];
  let values: number[] = [];
  walkXml(xml, (path, text) => {
    const last = path[path.length - 1];
    const parent = ancestor(path, 1);
    if (last === "Id" && ancestor(path, 2) === "MetricDataResults") id = text;
    else if (last === "member" && parent === "Timestamps") {
      const t = Date.parse(text);
      if (!Number.isNaN(t)) times.push(t);
    } else if (last === "member" && parent === "Values") {
      const v = Number(text);
      if (text !== "" && !Number.isNaN(v)) values.push(v);
    } else if (last === "member" && parent === "MetricDataResults") {
      // A SEARCH can match several series under one Id; keep the first.
      if (id && !(id in result)) {
        const n = Math.min(times.length, values.length);
        const points: MetricPoint[] = [];
        for (let i = 0; i < n; i++) points.push({ time: times[i]!, value: values[i]! });
        result[id] = points.sort((a, b) => a.time - b.time);
      }
      id = undefined;
      times = [];
      values = [];
    }
  });
  return result;
}
