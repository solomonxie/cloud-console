// AWS EC2 — Query API (XML), same shape as IAM's, but region-specific.
import type { AwsKey } from "./sigv4.ts";
import { awsFetch, queryUrl } from "./http.ts";
import { ancestor, walkXml } from "./xml.ts";

export interface EC2Instance {
  instanceId: string;
  instanceType: string;
  state: string;
  name?: string;
  launchTime?: string; // ISO 8601
}

export interface EC2StatusChecks {
  system?: string;
  instance?: string;
  ebs?: string;
}

const VERSION = "2016-11-15";

function ec2Url(region: string, params: Record<string, string>): string {
  return queryUrl(`https://ec2.${region}.amazonaws.com/`, { Version: VERSION, ...params });
}

export async function listInstances(key: AwsKey, region = "us-east-1"): Promise<EC2Instance[]> {
  const { text } = await awsFetch(key, { url: ec2Url(region, { Action: "DescribeInstances" }), region, service: "ec2" });
  return parseInstances(text);
}

export async function statusChecks(key: AwsKey, instanceId: string, region: string): Promise<EC2StatusChecks> {
  const url = ec2Url(region, {
    Action: "DescribeInstanceStatus",
    "InstanceId.1": instanceId,
    IncludeAllInstances: "true",
  });
  const { text } = await awsFetch(key, { url, region, service: "ec2" });
  return parseStatusChecks(text);
}

export async function listRegions(key: AwsKey): Promise<string[]> {
  const { text } = await awsFetch(key, {
    url: ec2Url("us-east-1", { Action: "DescribeRegions" }),
    region: "us-east-1",
    service: "ec2",
  });
  const regions: string[] = [];
  walkXml(text, (path, t) => {
    if (path[path.length - 1] === "regionName") regions.push(t);
  });
  return regions;
}

export function parseStatusChecks(xml: string): EC2StatusChecks {
  const checks: EC2StatusChecks = {};
  walkXml(xml, (path, text) => {
    if (path[path.length - 1] !== "status") return;
    switch (ancestor(path, 1)) {
      case "systemStatus": checks.system = text; break;
      case "instanceStatus": checks.instance = text; break;
      case "attachedEbsStatus": checks.ebs = text; break;
    }
  });
  return checks;
}

export function parseInstances(xml: string): EC2Instance[] {
  const instances: EC2Instance[] = [];
  let instanceId: string | undefined;
  let instanceType: string | undefined;
  let state: string | undefined;
  let name: string | undefined;
  let launchTime: string | undefined;
  let tagKey: string | undefined;

  walkXml(xml, (path, text) => {
    const last = path[path.length - 1];
    const parent = ancestor(path, 1);
    const inTag = parent === "item" && ancestor(path, 2) === "tagSet";
    if (last === "instanceId") instanceId = text;
    else if (last === "instanceType") instanceType = text;
    else if (last === "name" && parent === "instanceState") state = text;
    else if (last === "launchTime") launchTime = text;
    else if (last === "key" && inTag) tagKey = text;
    else if (last === "value" && inTag) {
      if (tagKey === "Name") name = text;
      tagKey = undefined;
    } else if (last === "item" && parent === "instancesSet") {
      if (instanceId) {
        instances.push({
          instanceId,
          instanceType: instanceType ?? "",
          state: state ?? "",
          ...(name !== undefined ? { name } : {}),
          ...(launchTime ? { launchTime: new Date(launchTime).toISOString() } : {}),
        });
      }
      instanceId = instanceType = state = name = launchTime = undefined;
    }
  });
  return instances;
}
