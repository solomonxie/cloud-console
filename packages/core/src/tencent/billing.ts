// Tencent Billing — TC3-signed POST/JSON to billing.tencentcloudapi.com,
// mapped into the provider-agnostic billing shapes.
import { tencentRequest } from "./api.ts";
import type { TencentKey } from "./tc3.ts";
import { mergeUsage, monthStartUTC, resourcesFromRows, type MonthToDateCost, type ServiceCost, type ServiceCostDetail } from "../billing.ts";

const base = { host: "billing.tencentcloudapi.com", service: "billing", version: "2018-07-09" };

function dateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

async function cost(key: TencentKey, begin: Date, end: Date): Promise<MonthToDateCost> {
  const r = await tencentRequest<{
    SummaryTotal?: { RealTotalCost?: string };
    SummaryOverview?: { BusinessCodeName: string; BusinessCode?: string; RealTotalCost?: string }[];
  }>(key, { ...base, action: "DescribeBillSummaryByProduct", payload: { BeginTime: dateTime(begin), EndTime: dateTime(end) } });
  const total = Number(r.SummaryTotal?.RealTotalCost ?? 0) || 0;
  const byService: ServiceCost[] = (r.SummaryOverview ?? [])
    .map((item) => ({ serviceName: item.BusinessCodeName, amount: Number(item.RealTotalCost ?? NaN), code: item.BusinessCode }))
    .filter((s) => !Number.isNaN(s.amount) && s.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const month = begin.toISOString().slice(0, 7);
  return { periodStart: `${month}-01`, periodEnd: month, total, unit: "CNY", byService, isEstimated: true };
}

/** Tencent's `Balance` is in fen (1/100 CNY). */
async function accountBalance(key: TencentKey): Promise<number> {
  const r = await tencentRequest<{ Balance: number }>(key, { ...base, action: "DescribeAccountBalance" });
  return r.Balance / 100;
}

export async function monthToDateCost(key: TencentKey, now = new Date()): Promise<MonthToDateCost> {
  const [result, balance] = await Promise.all([cost(key, monthStartUTC(now), now), accountBalance(key).catch(() => undefined)]);
  return balance === undefined ? result : { ...result, balance };
}

/** No multi-month mode: fans out `monthsBack + 1` concurrent requests. */
export async function monthlyBills(key: TencentKey, monthsBack: number, now = new Date()): Promise<MonthToDateCost[]> {
  const jobs: Promise<MonthToDateCost>[] = [];
  for (let offset = 0; offset <= monthsBack; offset++) {
    const start = monthStartUTC(now, -offset);
    const end = offset === 0 ? now : new Date(monthStartUTC(now, -offset + 1).getTime() - 1000);
    jobs.push(cost(key, start, end));
  }
  const results = await Promise.all(jobs);
  return results.sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0));
}

/** Billing item names folded into storage / data in / data out / requests. */
export function itemCategory(item: string): string {
  if (item.includes("下行") || item.includes("出流量") || item.includes("回源")) return "Data transfer out";
  if (item.includes("上行") || item.includes("入流量")) return "Data transfer in";
  if (item.includes("存储") || item.includes("容量")) return "Storage";
  if (item.includes("请求")) return "Requests";
  return item;
}

interface DetailPage {
  DetailSet?: { ResourceId?: string; ComponentSet?: { ItemCodeName?: string; ComponentCodeName?: string; RealCost?: string }[] }[];
  Total?: number;
}

/** One product's bill for a month (`yyyy-MM`) by resource and billing item. Sequential (rate-limited). */
export async function serviceDetail(key: TencentKey, product: ServiceCost, month: string): Promise<ServiceCostDetail> {
  const pageSize = 100;
  const maxPages = 20;
  const page = (offset: number) => {
    const payload: Record<string, unknown> = { Month: month, Offset: offset, Limit: pageSize, NeedRecordNum: 1 };
    if (product.code) payload.BusinessCode = product.code;
    return tencentRequest<DetailPage>(key, { ...base, action: "DescribeBillDetail", payload });
  };
  const first = await page(0);
  const total = first.Total ?? 0;
  const pages = Math.min(Math.ceil(total / pageSize), maxPages);
  const details = [...(first.DetailSet ?? [])];
  for (let i = 1; i < pages; i++) details.push(...((await page(i * pageSize)).DetailSet ?? []));

  const byResource = new Map<string, [string, number][]>();
  for (const d of details) {
    for (const c of d.ComponentSet ?? []) {
      const id = d.ResourceId ?? "";
      const rows = byResource.get(id) ?? [];
      rows.push([itemCategory(c.ItemCodeName ?? c.ComponentCodeName ?? ""), Number(c.RealCost ?? 0) || 0]);
      byResource.set(id, rows);
    }
  }
  const usage = mergeUsage([...byResource.values()].flat());
  return {
    serviceName: product.serviceName,
    unit: "CNY",
    total: usage.reduce((s, u) => s + u.amount, 0),
    usage,
    resources: resourcesFromRows(byResource),
    resourcesNote: total > maxPages * pageSize ? `Showing the first ${pages * pageSize} bill records.` : undefined,
  };
}
