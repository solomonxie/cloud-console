// Cost Explorer — AWS JSON 1.1 (POST + X-Amz-Target), global at us-east-1.
import type { AwsKey } from "./sigv4.ts";
import { awsJson } from "./http.ts";
import { errorMessage } from "./errors.ts";
import {
  addDaysUTC,
  mergeUsage,
  monthStartUTC,
  resourcesFromRows,
  ymdUTC,
  type MonthToDateCost,
  type ServiceCost,
  type ServiceCostDetail,
} from "../billing.ts";

interface Metric { Amount: string; Unit: string }
interface Group { Keys: string[]; Metrics: Record<string, Metric> }
interface ResultByTime { TimePeriod: { Start: string; End: string }; Groups: Group[]; Estimated: boolean }
interface CostResponse { ResultsByTime: ResultByTime[]; NextPageToken?: string }

function post(key: AwsKey, target: string, body: unknown): Promise<CostResponse> {
  return awsJson<CostResponse>(key, {
    url: "https://ce.us-east-1.amazonaws.com/",
    region: "us-east-1",
    service: "ce",
    target: `AWSInsightsIndexService.${target}`,
    body,
  });
}

export function parseCostAndUsage(decoded: CostResponse): MonthToDateCost[] {
  return decoded.ResultsByTime.map((result) => {
    const byService: ServiceCost[] = [];
    let total = 0;
    let unit = "USD";
    for (const group of result.Groups) {
      const name = group.Keys[0];
      const metric = group.Metrics.UnblendedCost;
      if (!name || !metric) continue;
      const amount = Number(metric.Amount) || 0;
      unit = metric.Unit;
      total += amount;
      if (amount > 0) byService.push({ serviceName: name, amount });
    }
    byService.sort((a, b) => b.amount - a.amount);
    return {
      periodStart: result.TimePeriod.Start,
      periodEnd: result.TimePeriod.End,
      total,
      unit,
      byService,
      isEstimated: result.Estimated,
    };
  });
}

async function getCostAndUsage(key: AwsKey, start: string, end: string): Promise<MonthToDateCost[]> {
  return parseCostAndUsage(
    await post(key, "GetCostAndUsage", {
      TimePeriod: { Start: start, End: end },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
    })
  );
}

/** Start of this UTC month through tomorrow (End is exclusive). */
export function monthToDateRange(now = new Date()): { start: string; end: string } {
  return { start: ymdUTC(monthStartUTC(now)), end: ymdUTC(addDaysUTC(now, 1)) };
}

export async function monthToDateCost(key: AwsKey, now = new Date()): Promise<MonthToDateCost> {
  const { start, end } = monthToDateRange(now);
  const results = await getCostAndUsage(key, start, end);
  return results[0] ?? { periodStart: start, periodEnd: end, total: 0, unit: "USD", byService: [], isEstimated: false };
}

/** Every month from `monthsBack` ago through the current one, in one MONTHLY call. */
export async function monthlyBills(key: AwsKey, monthsBack: number, now = new Date()): Promise<MonthToDateCost[]> {
  const start = ymdUTC(monthStartUTC(now, -monthsBack));
  const end = ymdUTC(addDaysUTC(now, 1));
  const results = await getCostAndUsage(key, start, end);
  return results.sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0));
}

/** Usage types grouped into the categories people think in. */
export function usageCategory(usageType: string): string {
  const type = usageType.replace(/^(?:[A-Z]{2,4}\d|EU)-/, "");
  if (type.includes("Out-Bytes") || type.includes("DataTransfer-Out")) return "Data transfer out";
  if (type.includes("In-Bytes") || type.includes("DataTransfer-In")) return "Data transfer in";
  if (type.includes("DataTransfer-Regional")) return "Data transfer (regional)";
  if (type.includes("TimedStorage") || type.includes("TagStorage")) return "Storage";
  if (type.includes("Requests")) return "Requests";
  if (type.includes("Retrieval")) return "Retrieval";
  return type;
}

const NAMED_CATEGORIES = new Set(["Data transfer out", "Data transfer in", "Storage", "Requests"]);

/** The period clipped to the last 14 days (13 back); undefined if it ends before that. */
export function resourceWindow(start: string, end: string, now = new Date()): { start: string; end: string } | undefined {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const earliest = ymdUTC(addDaysUTC(today, -13));
  const latest = ymdUTC(addDaysUTC(today, 1));
  const s = start > earliest ? start : earliest;
  const e = end < latest ? end : latest;
  return s < e ? { start: s, end: e } : undefined;
}

function lastDayBefore(exclusiveEnd: string): string {
  const t = Date.parse(`${exclusiveEnd}T00:00:00Z`);
  return Number.isNaN(t) ? exclusiveEnd : ymdUTC(new Date(t - 86_400_000));
}

async function groupedCosts(key: AwsKey, target: string, body: Record<string, unknown>) {
  const rows: { keys: string[]; amount: number; unit: string }[] = [];
  const request = { ...body };
  for (let i = 0; i < 20; i++) {
    const decoded = await post(key, target, request);
    for (const group of decoded.ResultsByTime.flatMap((r) => r.Groups)) {
      const metric = group.Metrics.UnblendedCost;
      if (!metric) continue;
      rows.push({ keys: group.Keys, amount: Number(metric.Amount) || 0, unit: metric.Unit });
    }
    if (!decoded.NextPageToken) break;
    request.NextPageToken = decoded.NextPageToken;
  }
  return rows;
}

/** One service's cost for a period by usage category, plus a per-resource split inside AWS's 14-day window. */
export async function serviceDetail(key: AwsKey, service: string, start: string, end: string, now = new Date()): Promise<ServiceCostDetail> {
  const filter = { Dimensions: { Key: "SERVICE", Values: [service] } };
  const usageGroups = groupedCosts(key, "GetCostAndUsage", {
    TimePeriod: { Start: start, End: end },
    Granularity: "MONTHLY",
    Metrics: ["UnblendedCost"],
    Filter: filter,
    GroupBy: [{ Type: "DIMENSION", Key: "USAGE_TYPE" }],
  });

  let resources: ServiceCostDetail["resources"] = [];
  let note: string | undefined;
  const window = resourceWindow(start, end, now);
  if (window) {
    try {
      const groups = await groupedCosts(key, "GetCostAndUsageWithResources", {
        TimePeriod: { Start: window.start, End: window.end },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        Filter: filter,
        GroupBy: [
          { Type: "DIMENSION", Key: "RESOURCE_ID" },
          { Type: "DIMENSION", Key: "USAGE_TYPE" },
        ],
      });
      const byResource = new Map<string, [string, number][]>();
      for (const g of groups) {
        const id = g.keys[0] ?? "";
        const rows = byResource.get(id) ?? [];
        rows.push([usageCategory(g.keys[g.keys.length - 1] ?? ""), g.amount]);
        byResource.set(id, rows);
      }
      resources = resourcesFromRows(byResource, NAMED_CATEGORIES);
    } catch (error) {
      note = `Per-resource costs need resource-level data turned on in Cost Explorer preferences. (${errorMessage(error)})`;
    }
  } else {
    note = "AWS keeps per-resource costs for the last 14 days only.";
  }

  const groups = await usageGroups;
  const usage = mergeUsage(groups.map((g) => [usageCategory(g.keys[0] ?? ""), g.amount]), NAMED_CATEGORIES);
  return {
    serviceName: service,
    unit: groups[0]?.unit ?? "USD",
    total: usage.reduce((s, u) => s + u.amount, 0),
    usage,
    resources,
    resourcesFrom: window?.start,
    resourcesTo: window ? lastDayBefore(window.end) : undefined,
    resourcesNote: note,
  };
}
