// SSM Parameter Store (AWS JSON 1.1, `ssm`). Regional. Metadata only in
// listings — values are fetched on the detail page and never cached.
import type { AwsKey } from "./sigv4.ts";
import { awsJson } from "./http.ts";
import type { DetailField } from "../detail.ts";
import { formatDateTime } from "../format.ts";

export interface SSMParameter {
  name: string;
  region: string;
  type: string;
  tier?: string;
  version?: number;
  lastModified?: string; // ISO 8601
  lastModifiedUser?: string;
  description?: string;
  dataType?: string;
  keyID?: string;
}

export function isSecure(p: SSMParameter): boolean {
  return p.type === "SecureString";
}

export function parameterDetailFields(p: SSMParameter): DetailField[] {
  const pairs: [string, string | undefined][] = [
    ["Name", p.name], ["Type", p.type], ["Data type", p.dataType], ["Tier", p.tier],
    ["Version", p.version !== undefined ? String(p.version) : undefined],
    ["Modified", p.lastModified ? formatDateTime(p.lastModified) : undefined],
    ["Modified by", p.lastModifiedUser], ["Description", p.description], ["KMS key", p.keyID], ["Region", p.region],
  ];
  return pairs.filter((pair): pair is [string, string] => !!pair[1]).map(([label, value]) => ({ label, value }));
}

function call<T>(key: AwsKey, target: string, body: unknown, region: string): Promise<T> {
  return awsJson<T>(key, { url: `https://ssm.${region}.amazonaws.com/`, region, service: "ssm", target: `AmazonSSM.${target}`, body });
}

interface RawParameter {
  Name?: string; Type?: string; Tier?: string; Version?: number; LastModifiedDate?: number;
  LastModifiedUser?: string; Description?: string; DataType?: string; KeyId?: string;
}

export async function listParameters(key: AwsKey, region: string): Promise<SSMParameter[]> {
  const all: SSMParameter[] = [];
  let token: string | undefined;
  do {
    const body: Record<string, unknown> = { MaxResults: 50 };
    if (token) body.NextToken = token;
    const object = await call<{ Parameters?: RawParameter[]; NextToken?: string }>(key, "DescribeParameters", body, region);
    for (const p of object.Parameters ?? []) {
      if (!p.Name) continue;
      all.push({
        name: p.Name, region, type: p.Type ?? "String", tier: p.Tier, version: p.Version,
        lastModified: p.LastModifiedDate !== undefined ? new Date(p.LastModifiedDate * 1000).toISOString() : undefined,
        lastModifiedUser: p.LastModifiedUser, description: p.Description, dataType: p.DataType, keyID: p.KeyId,
      });
    }
    token = object.NextToken;
  } while (token);
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function parameterValue(key: AwsKey, p: SSMParameter, decrypt: boolean): Promise<string> {
  const object = await call<{ Parameter?: { Value?: string } }>(key, "GetParameter", { Name: p.name, WithDecryption: decrypt }, p.region);
  return object.Parameter?.Value ?? "";
}
