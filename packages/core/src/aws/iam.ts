// Minimal IAM client — SigV4-signed Query API calls. IAM is a global
// service: always signed with region "us-east-1".
import type { AwsKey } from "./sigv4.ts";
import { awsFetch, queryUrl } from "./http.ts";
import { walkXml, xmlField } from "./xml.ts";
import { AwsError } from "./errors.ts";

export interface IAMUser {
  userName: string;
  arn: string;
  path: string;
  createDate?: string; // ISO 8601
}

export interface IAMRole {
  roleName: string;
  arn: string;
  path: string;
  createDate?: string;
}

export interface IAMPolicyAttachment {
  policyName: string;
  policyArn: string;
}

/** Auto-created by AWS for a service or SSO — not something a user manages directly. */
export function isServiceManagedRole(role: IAMRole): boolean {
  return role.path.startsWith("/aws-service-role/") || role.path.startsWith("/aws-reserved/");
}

async function request(key: AwsKey, action: string, params: Record<string, string> = {}): Promise<string> {
  const url = queryUrl("https://iam.amazonaws.com/", { Action: action, Version: "2010-05-08", ...params });
  const { text } = await awsFetch(key, { url, region: "us-east-1", service: "iam" });
  return text;
}

/** Generic `<Container><member>field…</member>…</Container>` parser. */
export function parseMembers<T>(xml: string, container: string, build: (fields: Record<string, string>) => T | undefined): T[] {
  const results: T[] = [];
  let current: Record<string, string> = {};
  walkXml(xml, (path, text) => {
    const n = path.length;
    if (n >= 3 && path[n - 3] === container && path[n - 2] === "member") {
      current[path[n - 1]!] = text;
      return;
    }
    if (path[n - 1] === "member" && path[n - 2] === container) {
      const value = build(current);
      if (value !== undefined) results.push(value);
      current = {};
    }
  });
  return results;
}

/** `<Container><member>value</member>…</Container>` — a flat string list. */
export function parseSimpleList(xml: string, container: string): string[] {
  const out: string[] = [];
  walkXml(xml, (path, text) => {
    if (path[path.length - 1] === "member" && path[path.length - 2] === container) out.push(text);
  });
  return out;
}

function iso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export async function listUsers(key: AwsKey): Promise<IAMUser[]> {
  return parseMembers(await request(key, "ListUsers"), "Users", (f) =>
    f.UserName && f.Arn ? { userName: f.UserName, arn: f.Arn, path: f.Path ?? "/", createDate: iso(f.CreateDate) } : undefined
  );
}

export async function listRoles(key: AwsKey): Promise<IAMRole[]> {
  return parseMembers(await request(key, "ListRoles"), "Roles", (f) =>
    f.RoleName && f.Arn ? { roleName: f.RoleName, arn: f.Arn, path: f.Path ?? "/", createDate: iso(f.CreateDate) } : undefined
  );
}

function attachments(xml: string): IAMPolicyAttachment[] {
  return parseMembers(xml, "AttachedPolicies", (f) =>
    f.PolicyName && f.PolicyArn ? { policyName: f.PolicyName, policyArn: f.PolicyArn } : undefined
  );
}

export async function listAttachedUserPolicies(key: AwsKey, userName: string): Promise<IAMPolicyAttachment[]> {
  return attachments(await request(key, "ListAttachedUserPolicies", { UserName: userName }));
}

export async function listUserPolicyNames(key: AwsKey, userName: string): Promise<string[]> {
  return parseSimpleList(await request(key, "ListUserPolicies", { UserName: userName }), "PolicyNames");
}

export async function listAttachedRolePolicies(key: AwsKey, roleName: string): Promise<IAMPolicyAttachment[]> {
  return attachments(await request(key, "ListAttachedRolePolicies", { RoleName: roleName }));
}

export async function listRolePolicyNames(key: AwsKey, roleName: string): Promise<string[]> {
  return parseSimpleList(await request(key, "ListRolePolicies", { RoleName: roleName }), "PolicyNames");
}

function decodedDocument(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function inlineUserPolicyDocument(key: AwsKey, userName: string, policyName: string): Promise<string> {
  const xml = await request(key, "GetUserPolicy", { UserName: userName, PolicyName: policyName });
  return decodedDocument(xmlField(xml, "PolicyDocument"));
}

export async function inlineRolePolicyDocument(key: AwsKey, roleName: string, policyName: string): Promise<string> {
  const xml = await request(key, "GetRolePolicy", { RoleName: roleName, PolicyName: policyName });
  return decodedDocument(xmlField(xml, "PolicyDocument"));
}

/** Managed policies keep their document on the default version. */
export async function attachedPolicyDocument(key: AwsKey, policyArn: string): Promise<string> {
  const versionId = xmlField(await request(key, "GetPolicy", { PolicyArn: policyArn }), "DefaultVersionId");
  if (!versionId) throw new AwsError(-1, "", `No default version for ${policyArn}`, `No default version for ${policyArn}`);
  const xml = await request(key, "GetPolicyVersion", { PolicyArn: policyArn, VersionId: versionId });
  return decodedDocument(xmlField(xml, "Document"));
}
