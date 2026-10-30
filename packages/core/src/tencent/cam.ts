// Tencent CAM — the IAM equivalent. Reuses IAMUser/IAMRole shapes; CAM has
// no literal ARN, so `arn` is a synthesized `uin/…` / `role/…` identifier.
import { parseTencentDate, tencentRequest } from "./api.ts";
import type { TencentKey } from "./tc3.ts";
import type { IAMRole, IAMUser } from "../aws/iam.ts";

export interface CAMPolicy {
  policyID: number;
  name: string;
}

const base = { host: "cam.tencentcloudapi.com", service: "cam", version: "2019-01-16" };

export async function listUsers(key: TencentKey): Promise<IAMUser[]> {
  const r = await tencentRequest<{ Data?: { Uin: number; Name: string; CreateTime?: string }[] }>(key, { ...base, action: "ListUsers" });
  return (r.Data ?? []).map((u) => ({ userName: u.Name, arn: `uin/${u.Uin}`, path: "/", createDate: parseTencentDate(u.CreateTime) }));
}

export async function listRoles(key: TencentKey): Promise<IAMRole[]> {
  const r = await tencentRequest<{ List?: { RoleId: string; RoleName: string; AddTime?: string }[] }>(key, {
    ...base, action: "DescribeRoleList", payload: { Page: 1, Rp: 200 },
  });
  return (r.List ?? []).map((x) => ({ roleName: x.RoleName, arn: `role/${x.RoleId}`, path: "/", createDate: parseTencentDate(x.AddTime) }));
}

type PolicyList = { List?: { PolicyId: number; PolicyName: string }[] };

export async function listAttachedUserPolicies(key: TencentKey, userArn: string): Promise<CAMPolicy[]> {
  const uin = Number(userArn.split("/").pop()) || 0;
  const r = await tencentRequest<PolicyList>(key, { ...base, action: "ListAttachedUserPolicies", payload: { TargetUin: uin, Page: 1, Rp: 200 } });
  return (r.List ?? []).map((p) => ({ policyID: p.PolicyId, name: p.PolicyName }));
}

export async function listAttachedRolePolicies(key: TencentKey, roleArn: string): Promise<CAMPolicy[]> {
  const roleId = roleArn.split("/").pop() ?? roleArn;
  const r = await tencentRequest<PolicyList>(key, { ...base, action: "ListAttachedRolePolicies", payload: { RoleId: roleId, Page: 1, Rp: 200 } });
  return (r.List ?? []).map((p) => ({ policyID: p.PolicyId, name: p.PolicyName }));
}

export async function policyDocument(key: TencentKey, policy: CAMPolicy): Promise<string> {
  const r = await tencentRequest<{ PolicyDocument?: string }>(key, { ...base, action: "GetPolicy", payload: { PolicyId: policy.policyID } });
  return r.PolicyDocument ?? "{}";
}
