// Demo mode (port of DemoCloud.swift): sample connections and resources from
// packages/demo. No network, no keychain, no resource cache, no writes.
// Fixtures are passed in (each app bundles the JSON its own way).
import { formatDateTime } from "../format.ts";
import type { Bucket } from "../aws/s3-buckets.ts";
import type { IAMPolicyAttachment } from "../aws/iam.ts";
import type { LambdaInvocation } from "../aws/lambda.ts";
import type { MetricPoint } from "../aws/cloudwatch-metrics.ts";
import type { ListPage } from "../storage/types.ts";
import type { EventBridgeItem } from "../events.ts";
import type { ResourceDetail } from "../detail.ts";
import { jsonifyDates, resolveDemo } from "./dates.ts";

export interface DemoFixtures {
  connections: unknown;
  aws: unknown;
  tencent: unknown;
}

export interface DemoConnection {
  id: string;
  vendor: string; // CloudVendor raw value: "AWS" | "Tencent Cloud"
  name: string;
  addedAt: string; // ISO 8601
}

export class DemoUnavailableError extends Error {
  constructor() {
    super("Not available in demo mode.");
    this.name = "DemoUnavailableError";
  }
}

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A demo connection's "access key id" is its fixture name. */
export function demoFixtureName(vendor: string): "aws" | "tencent" {
  return vendor === "Tencent Cloud" || vendor === "tencent" ? "tencent" : "aws";
}

function uuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class DemoCloud {
  private readonly fixtures: DemoFixtures;
  private readonly clock: () => Date;

  constructor(fixtures: DemoFixtures, clock: () => Date = () => new Date()) {
    this.fixtures = fixtures;
    this.clock = clock;
  }

  /** Resolved fresh on each call so "@today" tracks the clock, like Swift's load(). */
  private raw(name: string): unknown {
    const source = name === "connections" ? this.fixtures.connections : name === "tencent" ? this.fixtures.tencent : name === "aws" ? this.fixtures.aws : undefined;
    return resolveDemo(source, this.clock());
  }

  private fixture(name: string): Obj {
    return asObj(this.raw(name));
  }

  connections(): DemoConnection[] {
    return jsonifyDates(asArr(this.raw("connections"))) as DemoConnection[];
  }

  /**
   * A list page's value by cache key `<kind>[@<region>]:<fixture>[:<suffix>]`.
   * Regional kinds are `{region: [...]}`; an unlisted region is empty.
   */
  value<T>(cacheKey: string): T {
    const colon = cacheKey.indexOf(":");
    if (colon < 0) throw new DemoUnavailableError();
    const kindPart = cacheKey.slice(0, colon);
    const rest = cacheKey.slice(colon + 1);
    const fixtureName = rest.split(":")[0]!;
    const at = kindPart.indexOf("@");
    const kind = at < 0 ? kindPart : kindPart.slice(0, at);
    const json = this.fixture(fixtureName)[kind];
    if (json === undefined) throw new DemoUnavailableError();
    if (at < 0) return jsonifyDates(json) as T;
    const region = kindPart.slice(at + 1);
    return jsonifyDates(asObj(json)[region] ?? []) as T;
  }

  buckets(fixtureName: string): Bucket[] {
    const f = this.fixture(fixtureName);
    const list = jsonifyDates(asArr(f["s3-buckets"] ?? f["cos-buckets"])) as Bucket[];
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  region(bucket: string): string {
    for (const name of ["aws", "tencent"]) {
      const match = this.buckets(name).find((b) => b.name === bucket);
      if (match) return match.region ?? "us-east-1";
    }
    return "us-east-1";
  }

  objects(fixtureName: string, bucket: string, prefix: string): ListPage {
    const listing = asObj(asObj(this.fixture(fixtureName).objects)[bucket])[prefix];
    if (!listing) return { folders: [], objects: [] };
    const page = jsonifyDates(listing) as { folders?: string[]; objects?: ListPage["objects"] };
    return { folders: page.folders ?? [], objects: page.objects ?? [] };
  }

  /** Preview bytes: a short text stand-in, since the objects don't exist anywhere. */
  download(key: string): string {
    return `Demo file: ${key}\nSample content for demo mode — nothing was downloaded.\n`;
  }

  private policies(fixtureName: string, principal: string): Obj {
    return asObj(asObj(this.fixture(fixtureName).policies)[principal]);
  }

  attachedPolicies(fixtureName: string, principal: string): IAMPolicyAttachment[] {
    return asArr(this.policies(fixtureName, principal).attached)
      .filter((row): row is string[] => Array.isArray(row) && row.length === 2)
      .map(([policyName, policyArn]) => ({ policyName: String(policyName), policyArn: String(policyArn) }));
  }

  inlinePolicyNames(fixtureName: string, principal: string): string[] {
    return asArr(this.policies(fixtureName, principal).inline).map(String);
  }

  /** CAM names principals by `uin/…` / `role/…`; mapped back to the user/role name. */
  camPolicyNames(fixtureName: string, arn: string): string[] {
    const f = this.fixture(fixtureName);
    const principals = [...asArr(f["cam-users"]), ...asArr(f["cam-roles"])].map(asObj);
    const match = principals.find((p) => p.arn === arn);
    const name = match ? (match.userName ?? match.roleName) : undefined;
    if (typeof name !== "string") return [];
    return this.attachedPolicies(fixtureName, name).map((p) => p.policyName);
  }

  policyDocument(fixtureName: string, nameOrArn: string): string {
    const documents = asObj(this.fixture(fixtureName).documents);
    const name = nameOrArn.split("/").pop() || nameOrArn;
    const document = documents[name] ?? documents.default;
    if (document === undefined) return "{}";
    return JSON.stringify(sortKeysDeep(document), null, 2);
  }

  /** Echoes the input back; nothing is invoked. */
  invoke(fn: string, payload: string): LambdaInvocation {
    const requestID = uuidV4();
    return {
      isError: false,
      status: "Succeeded · 200",
      response: `{"statusCode":200,"body":"Demo run of ${fn} — nothing was invoked.","input":${payload}}`,
      log: [
        `START RequestId: ${requestID} Version: $LATEST`,
        `INFO\tevent received ${payload}`,
        `END RequestId: ${requestID}`,
        `REPORT RequestId: ${requestID}\tDuration: 42.17 ms\tBilled Duration: 43 ms\tMemory Size: 1024 MB\tMax Memory Used: 88 MB`,
      ].join("\n"),
    };
  }

  parameterValue(fixtureName: string, name: string): string {
    const regions = asObj(this.fixture(fixtureName)["ssm-parameters"]);
    for (const list of Object.values(regions)) {
      const match = asArr(list).map(asObj).find((p) => p.name === name);
      if (match) return typeof match.value === "string" ? match.value : "";
    }
    return "";
  }

  /** Each fixture item carries `detail: {fields: [[label, value]], documents: [[title, text]]}`. */
  eventBridgeDetail(fixtureName: string, item: EventBridgeItem): ResourceDetail {
    const f = this.fixture(fixtureName);
    const list = asObj(f.eventbridge)[item.region] ?? f["tencent-eventbridge"];
    const match = asArr(list)
      .map(asObj)
      .find((x) => x.kind === item.kind && x.container === item.container && x.name === item.name);
    const detail = asObj(match?.detail);
    const text = (v: unknown) => (v instanceof Date ? formatDateTime(v) : String(v));
    return {
      fields: asArr(detail.fields)
        .filter((r): r is unknown[] => Array.isArray(r) && r.length === 2)
        .map((r) => ({ label: String(r[0]), value: text(r[1]) })),
      documents: asArr(detail.documents)
        .filter((r): r is unknown[] => Array.isArray(r) && r.length === 2)
        .map((r) => ({ title: String(r[0]), text: String(r[1]) })),
    };
  }

  /** Smooth made-up series, steady per metric id. `from`/`to` epoch ms, `period` seconds. */
  metrics(ids: string[], from: number, to: number, period: number): Record<string, MetricPoint[]> {
    const base: Record<string, number> = { cpu: 23, mem: 61, disk: 47, netIn: 180_000, netOut: 95_000, diskRead: 40_000, diskWrite: 120_000 };
    const out: Record<string, MetricPoint[]> = {};
    ids.forEach((id, seed) => {
      const level = base[id];
      if (level === undefined) return;
      const points: MetricPoint[] = [];
      for (let t = from, i = 0; t <= to; t += period * 1000, i++) {
        points.push({ time: t, value: level * (1 + 0.35 * Math.sin(i / 3 + seed) + 0.1 * Math.cos(i * 1.7)) });
      }
      out[id] = points;
    });
    return out;
  }

  newId(): string {
    return uuidV4().toUpperCase();
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeysDeep((value as Obj)[k])])
    );
  }
  return value;
}
