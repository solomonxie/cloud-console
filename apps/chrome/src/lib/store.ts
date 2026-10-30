// Storage connections (name + keys) are kept only in chrome.storage.local —
// never synced, never sent anywhere except directly to the provider they name.
import type { StorageConnection } from "@cloud-console/core/storage/connection";

const CONNECTIONS_KEY = "connections";

export async function getConnections(): Promise<StorageConnection[]> {
  const stored = await chrome.storage.local.get(CONNECTIONS_KEY);
  const connections = (stored[CONNECTIONS_KEY] as StorageConnection[] | undefined) ?? [];
  // Self-heal: earlier versions of the connection form could leave behind
  // entries with neither a name nor a bucket (nothing to identify or browse
  // with) — prune those from storage itself instead of showing blank rows.
  const valid = connections.filter((c) => c.bucket || c.name);
  if (valid.length !== connections.length) await saveConnections(valid);
  return valid;
}

async function saveConnections(connections: StorageConnection[]): Promise<StorageConnection[]> {
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
  return connections;
}

export async function upsertConnection(conn: StorageConnection): Promise<StorageConnection[]> {
  const connections = await getConnections();
  const idx = connections.findIndex((c) => c.id === conn.id);
  if (idx >= 0) connections[idx] = conn;
  else connections.push(conn);
  return saveConnections(connections);
}

export async function deleteConnection(id: string): Promise<StorageConnection[]> {
  const connections = (await getConnections()).filter((c) => c.id !== id);
  return saveConnections(connections);
}

export function newConnectionId(): string {
  return crypto.randomUUID();
}
