// Google Cloud accounts: name + credentials JSON (service account key or
// gcloud ADC), stored only in chrome.storage.local under `gcpAccounts` —
// never synced, only ever sent to Google's own token endpoint.

import { credentialsProblem, type GoogleCredentials } from "@cloud-console/core/gcp/auth";

const ACCOUNTS_KEY = "gcpAccounts";
const LAST_ACCOUNT_KEY = "gcpLastAccountId";

export interface GcpAccount {
  id: string;
  type: "gcp";
  name: string;
  credentialsJson: string;
  lastProjectId?: string;
}

export async function getAccounts(): Promise<GcpAccount[]> {
  const data = await chrome.storage.local.get(ACCOUNTS_KEY);
  const list = data[ACCOUNTS_KEY];
  return Array.isArray(list) ? (list as GcpAccount[]) : [];
}

async function saveAccounts(accounts: GcpAccount[]): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
}

export async function upsertAccount(account: GcpAccount): Promise<void> {
  const accounts = await getAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  await saveAccounts(accounts);
}

export async function deleteAccount(id: string): Promise<void> {
  await saveAccounts((await getAccounts()).filter((a) => a.id !== id));
}

export async function rememberProject(id: string, projectId: string): Promise<void> {
  const accounts = await getAccounts();
  const acct = accounts.find((a) => a.id === id);
  if (!acct || acct.lastProjectId === projectId) return;
  acct.lastProjectId = projectId;
  await saveAccounts(accounts);
}

export async function getLastAccountId(): Promise<string | undefined> {
  const data = await chrome.storage.local.get(LAST_ACCOUNT_KEY);
  return data[LAST_ACCOUNT_KEY] as string | undefined;
}

export async function setLastAccountId(id: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_ACCOUNT_KEY]: id });
}

// Parses + validates pasted/loaded credentials JSON. Throws a user-facing
// message on problems.
export function parseCredentials(json: string): GoogleCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Credentials aren't valid JSON.");
  }
  const problem = credentialsProblem(parsed);
  if (problem) throw new Error(problem);
  return parsed as GoogleCredentials;
}

export function credentialsLabel(creds: GoogleCredentials): string {
  return creds.type === "authorized_user" ? "gcloud user credentials" : creds.client_email;
}

export function newAccountId(): string {
  return crypto.randomUUID();
}
