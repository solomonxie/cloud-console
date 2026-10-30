// Secret Manager v1: list secrets and versions, and access a version's
// payload. Only ever what the credential's own IAM allows — listing needs
// secretmanager.secrets.list / versions.list (roles/secretmanager.viewer),
// reading a value needs secretmanager.versions.access
// (roles/secretmanager.secretAccessor).

import type { GoogleCredentials } from "./auth.ts";
import { base64ToBytes } from "./base64.ts";
import { collectPages, gcpRequest, lastSegment } from "./request.ts";

const BASE = "https://secretmanager.googleapis.com/v1";

export interface Secret {
  name: string; // "projects/123/secrets/my-secret"
  createTime?: string;
  labels?: Record<string, string>;
  replication?: { automatic?: object; userManaged?: { replicas?: { location: string }[] } };
  expireTime?: string;
  etag?: string;
  versionAliases?: Record<string, string>;
}

export interface SecretSummary extends Secret {
  secretId: string; // "my-secret"
}

export type SecretVersionState = "ENABLED" | "DISABLED" | "DESTROYED" | "STATE_UNSPECIFIED";

export interface SecretVersion {
  name: string; // "projects/123/secrets/my-secret/versions/3"
  createTime?: string;
  destroyTime?: string;
  state: SecretVersionState;
  etag?: string;
}

export interface SecretVersionSummary extends SecretVersion {
  version: string; // "3"
}

export interface SecretPayload {
  name: string; // resolved version name (`latest` resolves to a number)
  bytes: Uint8Array;
  text: string | null; // null when the payload isn't valid UTF-8 text
  isBinary: boolean;
}

interface ListSecretsResponse {
  secrets?: Secret[];
  nextPageToken?: string;
  totalSize?: number;
}

interface ListVersionsResponse {
  versions?: SecretVersion[];
  nextPageToken?: string;
}

interface AccessResponse {
  name: string;
  payload?: { data?: string; dataCrc32c?: string };
}

export async function listSecrets(creds: GoogleCredentials, project: string): Promise<SecretSummary[]> {
  const secrets = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListSecretsResponse>(
      creds,
      `${BASE}/projects/${encodeURIComponent(project)}/secrets`,
      { query: { pageToken, pageSize: 250 } }
    );
    return { items: r.secrets ?? [], nextPageToken: r.nextPageToken };
  });
  return secrets
    .map((s) => ({ ...s, secretId: lastSegment(s.name) }))
    .sort((a, b) => a.secretId.localeCompare(b.secretId));
}

function secretPath(project: string, secretId: string): string {
  return `${BASE}/projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(secretId)}`;
}

export function getSecret(creds: GoogleCredentials, project: string, secretId: string): Promise<Secret> {
  return gcpRequest<Secret>(creds, secretPath(project, secretId));
}

export async function listSecretVersions(
  creds: GoogleCredentials,
  project: string,
  secretId: string
): Promise<SecretVersionSummary[]> {
  const versions = await collectPages(async (pageToken) => {
    const r = await gcpRequest<ListVersionsResponse>(creds, `${secretPath(project, secretId)}/versions`, {
      query: { pageToken, pageSize: 250 },
    });
    return { items: r.versions ?? [], nextPageToken: r.nextPageToken };
  });
  return versions
    .map((v) => ({ ...v, version: lastSegment(v.name) }))
    .sort((a, b) => Number(b.version) - Number(a.version));
}

// Decodes a payload, treating it as text only if it is valid UTF-8 without
// control characters other than tab/newline/CR.
export function decodeSecretPayload(name: string, base64Data: string): SecretPayload {
  const bytes = base64ToBytes(base64Data);
  let text: string | null = null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded)) text = decoded;
  } catch {
    text = null;
  }
  return { name, bytes, text, isBinary: text === null };
}

// Reads a version's value (`version` defaults to "latest"). Callers must
// not persist the result.
export async function accessSecretVersion(
  creds: GoogleCredentials,
  project: string,
  secretId: string,
  version = "latest"
): Promise<SecretPayload> {
  const r = await gcpRequest<AccessResponse>(
    creds,
    `${secretPath(project, secretId)}/versions/${encodeURIComponent(version)}:access`
  );
  return decodeSecretPayload(r.name, r.payload?.data ?? "");
}
