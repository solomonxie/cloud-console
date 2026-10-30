// Tencent CVM — the EC2 equivalent. TC3-signed, region-specific (default ap-guangzhou).
import { tencentRequest } from "./api.ts";
import type { TencentKey } from "./tc3.ts";
import type { DetailField } from "../detail.ts";

export interface CVMInstance {
  instanceId: string;
  instanceName: string;
  instanceType: string;
  state: string;
}

export async function listInstances(key: TencentKey, region = "ap-guangzhou"): Promise<CVMInstance[]> {
  const r = await tencentRequest<{ InstanceSet?: { InstanceId: string; InstanceName: string; InstanceType: string; InstanceState: string }[] }>(
    key,
    { host: "cvm.tencentcloudapi.com", service: "cvm", action: "DescribeInstances", version: "2017-03-12", region }
  );
  return (r.InstanceSet ?? []).map((i) => ({
    instanceId: i.InstanceId, instanceName: i.InstanceName, instanceType: i.InstanceType, state: i.InstanceState,
  }));
}

export function cvmDetailFields(i: CVMInstance): DetailField[] {
  return [
    { label: "Instance ID", value: i.instanceId },
    { label: "Name", value: i.instanceName },
    { label: "Type", value: i.instanceType },
    { label: "State", value: i.state },
  ];
}
