// The storage section's in-memory state: which connection/bucket/folder is
// open, what's listed, selected and on the clipboard.
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import type { StorageClient } from "@cloud-console/core/storage/types";

export interface Item {
  key: string;
  isFolder: boolean;
}

export interface Clipboard {
  items: Item[];
  cut: boolean;
  bucket: string;
  connectionId: string | null;
}

export const state = {
  connections: [] as StorageConnection[],
  activeId: null as string | null,
  client: null as StorageClient | null,
  bucket: null as string | null,
  prefix: "",
  token: null as string | null,
  stats: { folders: 0, files: 0, bytes: 0 },
  listedItems: [] as Item[], // currently loaded rows, for "select all"
  selectMode: false,
  selected: new Map<string, Item>(),
  clipboard: null as Clipboard | null,
};

export function activeConnection(): StorageConnection | null {
  return state.connections.find((c) => c.id === state.activeId) || null;
}

// A connection's own prefix (if any) is a hard boundary: browsing never goes
// above it, so the root crumb represents that scope, not the whole bucket.
export function rootPrefix(): string {
  return activeConnection()?.prefix || "";
}

// The open bucket's client, for actions only reachable inside a bucket.
export function open(): { client: StorageClient; bucket: string } {
  if (!state.client || !state.bucket) throw new Error("No bucket open");
  return { client: state.client, bucket: state.bucket };
}
