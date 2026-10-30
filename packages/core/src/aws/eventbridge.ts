// EventBridge rules and buses (AWS JSON 1.1, `events`) plus EventBridge
// Scheduler schedules (REST/JSON, `scheduler`). Both regional.
import type { AwsKey } from "./sigv4.ts";
import { awsFetch, awsJson } from "./http.ts";
import type { EventBridgeItem } from "../events.ts";
import { fields, prettyJson, prettyJsonString, type ResourceDetail } from "../detail.ts";
import { formatDateTime } from "../format.ts";

type Obj = Record<string, unknown>;

function call(key: AwsKey, target: string, body: Obj, region: string): Promise<Obj> {
  return awsJson<Obj>(key, { url: `https://events.${region}.amazonaws.com/`, region, service: "events", target: `AWSEvents.${target}`, body });
}

async function scheduler(key: AwsKey, url: string, region: string): Promise<Obj> {
  const { text } = await awsFetch(key, { url, region, service: "scheduler", errors: "json" });
  return text ? (JSON.parse(text) as Obj) : {};
}

async function paged(key: AwsKey, target: string, listKey: string, body: Obj, region: string): Promise<Obj[]> {
  const all: Obj[] = [];
  let token: string | undefined;
  do {
    const request = { ...body };
    if (token) request.NextToken = token;
    const object = await call(key, target, request, region);
    all.push(...((object[listKey] as Obj[] | undefined) ?? []));
    token = object.NextToken as string | undefined;
  } while (token);
  return all;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

async function busesAndRules(key: AwsKey, region: string): Promise<EventBridgeItem[]> {
  const items: EventBridgeItem[] = [];
  for (const bus of await paged(key, "ListEventBuses", "EventBuses", {}, region)) {
    const busName = str(bus.Name);
    if (!busName) continue;
    const rules = await paged(key, "ListRules", "Rules", { EventBusName: busName }, region);
    if (busName !== "default" || rules.length > 0) {
      items.push({ kind: "Event bus", name: busName, container: "", region, summary: str(bus.Description), ref: str(bus.Arn) });
    }
    for (const rule of rules) {
      const name = str(rule.Name);
      if (!name) continue;
      const summary = str(rule.ScheduleExpression) ?? (rule.EventPattern !== undefined ? "Event pattern" : undefined);
      items.push({ kind: "Rule", name, container: busName, region, state: str(rule.State), summary, ref: str(rule.Arn) });
    }
  }
  return items;
}

async function schedules(key: AwsKey, region: string): Promise<EventBridgeItem[]> {
  const items: EventBridgeItem[] = [];
  let token: string | undefined;
  do {
    const url = new URL(`https://scheduler.${region}.amazonaws.com/schedules`);
    if (token) url.searchParams.set("NextToken", token);
    const object = await scheduler(key, url.toString(), region);
    for (const s of (object.Schedules as Obj[] | undefined) ?? []) {
      const name = str(s.Name);
      if (!name) continue;
      const target = str((s.Target as Obj | undefined)?.Arn);
      items.push({
        kind: "Schedule", name, container: str(s.GroupName) ?? "default", region, state: str(s.State),
        summary: target?.split(":").pop(), ref: str(s.Arn),
      });
    }
    token = str(object.NextToken);
  } while (token);
  return items;
}

export async function listItems(key: AwsKey, region: string): Promise<EventBridgeItem[]> {
  const items: EventBridgeItem[] = [];
  let firstError: unknown;
  try {
    items.push(...(await busesAndRules(key, region)));
  } catch (error) {
    firstError = error;
  }
  try {
    items.push(...(await schedules(key, region)));
  } catch (error) {
    firstError = firstError ?? error;
    if (items.length === 0) throw error;
  }
  if (items.length === 0 && firstError) throw firstError;
  return items;
}

const epoch = (v: unknown): string | undefined => (typeof v === "number" ? formatDateTime(v * 1000) : undefined);

export async function detail(key: AwsKey, item: EventBridgeItem): Promise<ResourceDetail> {
  if (item.kind === "Rule") {
    const rule = await call(key, "DescribeRule", { Name: item.name, EventBusName: item.container }, item.region);
    const targets = await paged(key, "ListTargetsByRule", "Targets", { Rule: item.name, EventBusName: item.container }, item.region);
    const out: ResourceDetail = {
      fields: fields([
        ["Name", rule.Name], ["Event bus", rule.EventBusName], ["State", rule.State],
        ["Schedule", rule.ScheduleExpression], ["Description", rule.Description],
        ["Managed by", rule.ManagedBy], ["Role", rule.RoleArn], ["ARN", rule.Arn], ["Region", item.region],
      ]),
      documents: [],
    };
    const pattern = str(rule.EventPattern);
    if (pattern) out.documents.push({ title: "Event pattern", text: prettyJsonString(pattern) });
    for (const t of targets) out.documents.push({ title: `Target · ${str(t.Id) ?? "?"}`, text: prettyJson(t) });
    return out;
  }
  if (item.kind === "Schedule") {
    const url = new URL(`https://scheduler.${item.region}.amazonaws.com/schedules/${encodeURIComponent(item.name)}`);
    url.searchParams.set("groupName", item.container);
    const s = await scheduler(key, url.toString(), item.region);
    const target = s.Target as Obj | undefined;
    const window = s.FlexibleTimeWindow as Obj | undefined;
    const out: ResourceDetail = {
      fields: fields([
        ["Name", s.Name], ["Group", s.GroupName], ["State", s.State],
        ["Expression", s.ScheduleExpression], ["Time zone", s.ScheduleExpressionTimezone],
        ["Start", epoch(s.StartDate)], ["End", epoch(s.EndDate)], ["Created", epoch(s.CreationDate)],
        ["Modified", epoch(s.LastModificationDate)], ["Description", s.Description],
        ["Target", target?.Arn], ["Role", target?.RoleArn], ["Flexible window", window?.Mode],
        ["After completion", s.ActionAfterCompletion], ["ARN", s.Arn], ["Region", item.region],
      ]),
      documents: [],
    };
    if (target) out.documents.push({ title: "Target", text: prettyJson(target) });
    return out;
  }
  const bus = await call(key, "DescribeEventBus", { Name: item.name }, item.region);
  const out: ResourceDetail = {
    fields: fields([["Name", bus.Name], ["Description", bus.Description], ["ARN", bus.Arn], ["Region", item.region]]),
    documents: [],
  };
  const policy = str(bus.Policy);
  if (policy) out.documents.push({ title: "Policy", text: prettyJsonString(policy) });
  return out;
}
