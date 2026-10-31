// The bucket screen's in-memory state: which connection/bucket/folder is
// open, what's listed, selected and on the clipboard. Only one bucket screen
// is ever on the stack, so this is module-level and reset on every push.
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
  // The open connection — from storage, or a synthetic one (e.g. a GCS
  // bucket opened from a Google Cloud account) that isn't stored anywhere.
  conn: null as StorageConnection | null,
  client: null as StorageClient | null,
  bucket: null as string | null,
  prefix: "",
  token: null as string | null,
  stats: { folders: 0, files: 0, bytes: 0 },
  listedItems: [] as Item[], // currently loaded rows, for "select all"
  filter: "", // name filter over the loaded rows
  selectMode: false,
  selected: new Map<string, Item>(),
  clipboard: null as Clipboard | null,
};

// A connection's own prefix (if any) is a hard boundary: browsing never goes
// above it, so the root crumb represents that scope, not the whole bucket.
export function rootPrefix(): string {
  return state.conn?.prefix || "";
}

// The open bucket's client, for actions only reachable inside a bucket.
export function open(): { client: StorageClient; bucket: string } {
  if (!state.client || !state.bucket) throw new Error("No bucket open");
  return { client: state.client, bucket: state.bucket };
}
