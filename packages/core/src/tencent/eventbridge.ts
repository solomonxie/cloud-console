// Tencent EventBridge (`eb`) — buses, rules and targets. Timer rules are
// ordinary rules here; Tencent has no separate scheduler product.
import { tencentRequest } from "./api.ts";
import type { TencentKey } from "./tc3.ts";
import type { EventBridgeItem } from "../events.ts";
import { fields, prettyJson, prettyJsonString, type ResourceDetail } from "../detail.ts";

export const CEB_REGIONS = ["ap-guangzhou", "ap-shanghai", "ap-beijing", "ap-hongkong", "ap-singapore"];

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function call(key: TencentKey, action: string, payload: Obj, region: string): Promise<Obj> {
  return tencentRequest<Obj>(key, { host: "eb.tencentcloudapi.com", service: "eb", action, version: "2021-04-16", region, payload });
}

async function busList(key: TencentKey, region: string): Promise<Obj[]> {
  return ((await call(key, "ListEventBuses", { Limit: 100 }, region)).EventBuses as Obj[] | undefined) ?? [];
}

function enabled(rule: Obj): string | undefined {
  return typeof rule.Enable === "boolean" ? (rule.Enable ? "ENABLED" : "DISABLED") : undefined;
}

async function busesAndRules(key: TencentKey, region: string): Promise<EventBridgeItem[]> {
  const items: EventBridgeItem[] = [];
  for (const bus of await busList(key, region)) {
    const id = str(bus.EventBusId);
    const name = str(bus.EventBusName);
    if (!id || !name) continue;
    const rules = ((await call(key, "ListRules", { EventBusId: id, Limit: 100 }, region)).Rules as Obj[] | undefined) ?? [];
    if (bus.Type !== "Cloud" || rules.length > 0) {
      items.push({ kind: "Event bus", name, container: "", region, summary: str(bus.Description), ref: id });
    }
    for (const rule of rules) {
      const ruleName = str(rule.RuleName);
      if (!ruleName) continue;
      items.push({ kind: "Rule", name: ruleName, container: id, region, state: enabled(rule), summary: str(rule.Description), ref: str(rule.RuleId) });
    }
  }
  return items;
}

/** Scans CEB_REGIONS one at a time; fails only if every region failed. */
export async function listItems(key: TencentKey): Promise<EventBridgeItem[]> {
  const items: EventBridgeItem[] = [];
  let firstError: unknown;
  for (const region of CEB_REGIONS) {
    try {
      items.push(...(await busesAndRules(key, region)));
    } catch (error) {
      firstError = firstError ?? error;
    }
  }
  if (items.length === 0 && firstError) throw firstError;
  return items;
}

export async function detail(key: TencentKey, item: EventBridgeItem): Promise<ResourceDetail> {
  if (item.kind === "Event bus") {
    const bus = (await busList(key, item.region)).find((b) => b.EventBusId === item.ref) ?? {};
    return {
      fields: fields([
        ["Name", bus.EventBusName], ["ID", bus.EventBusId], ["Description", bus.Description],
        ["Type", bus.Type], ["Created", bus.AddTime], ["Modified", bus.ModTime], ["Region", item.region],
      ]),
      documents: [],
    };
  }
  const ids = { EventBusId: item.container, RuleId: item.ref ?? "" };
  const rule = await call(key, "GetRule", ids, item.region);
  const targets = await call(key, "ListTargets", ids, item.region);
  const out: ResourceDetail = {
    fields: fields([
      ["Name", rule.RuleName], ["ID", rule.RuleId], ["Event bus", item.container],
      ["State", enabled(rule)], ["Status", rule.Status], ["Description", rule.Description],
      ["Created", rule.AddTime], ["Modified", rule.ModTime], ["Region", item.region],
    ]),
    documents: [],
  };
  const pattern = str(rule.EventPattern);
  if (pattern) out.documents.push({ title: "Event pattern", text: prettyJsonString(pattern) });
  for (const t of (targets.Targets as Obj[] | undefined) ?? []) {
    out.documents.push({ title: `Target · ${str(t.TargetId) ?? "?"}`, text: prettyJson(t) });
  }
  return out;
}
