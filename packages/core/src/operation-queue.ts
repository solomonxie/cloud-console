// One-at-a-time queue of object-storage writes (delete/copy/move/upload),
// persisted through a KeyValueStore — port of S3OperationQueue.swift.
// Unfinished items stay `pending` and resume on the next `start()`.
// Unlike iOS's background URLSession, JS requests stop when the app is
// suspended; the persisted state is what makes resuming safe.
import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { KeyValueStore } from "./cache.ts";
import { displayName, type ObjectStore, type PutBody, type StorageService } from "./object-store.ts";

export type OperationKind = "delete" | "copy" | "move" | "upload";
export type OperationStatus = "running" | "completed" | "failed";
export type ItemState = "pending" | "copied" | "done" | "failed";

export interface OperationItem {
  source: string; // object key, or a staged local file URI for uploads
  destination?: string;
  state: ItemState;
}

export interface StorageOperation {
  id: string;
  connectionID: string;
  service: StorageService;
  bucket: string;
  region: string;
  /** Destination for a cross-bucket copy/move; undefined means same bucket. */
  destBucket?: string;
  destRegion?: string;
  kind: OperationKind;
  label: string;
  items: OperationItem[];
  status: OperationStatus;
  errorMessage?: string;
  createdAt: string;
}

export function completedCount(op: StorageOperation): number {
  return op.items.filter((i) => i.state === "done").length;
}

export function isFinished(op: StorageOperation): boolean {
  return op.status === "completed" || op.status === "failed";
}

// Naming helpers — exactly the Swift app's.

/** Duplicates next to the original with a "-copy" suffix. */
export function duplicateKey(key: string, isFolder: boolean): string {
  if (isFolder) return `${key.slice(0, -1)}-copy/`;
  const name = key.split("/").pop() ?? key;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${key}-copy`;
  const ext = name.slice(dot + 1);
  return `${key.slice(0, key.length - ext.length - 1)}-copy.${ext}`;
}

export function renamedKey(key: string, isFolder: boolean, newName: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf("/");
  const parent = slash >= 0 ? trimmed.slice(0, slash + 1) : "";
  return isFolder ? `${parent}${newName}/` : parent + newName;
}

export interface QueueDeps {
  store: KeyValueStore;
  /** Object store for a connection's credentials, or undefined if it has none. */
  objectStore: (connectionID: string, service: StorageService) => Promise<ObjectStore | undefined>;
  /** Reads a staged upload's bytes. */
  readStaged: (uri: string) => Promise<PutBody & (ArrayBuffer | Uint8Array)>;
  removeStaged?: (op: StorageOperation) => Promise<void>;
  contentType?: (key: string) => string | undefined;
  newId: () => string;
  /** Demo mode: nothing is ever sent. */
  isDemo?: () => boolean;
}

const STORE_KEY = "s3-operations.json";
const BATCH_DELETE_CHUNK = 1000;

type Listener = (ops: StorageOperation[]) => void;

export class OperationQueue {
  private operations: StorageOperation[] = [];
  private busy = false;
  private listeners = new Set<Listener>();
  private loaded = false;

  constructor(private readonly deps: QueueDeps) {}

  get all(): StorageOperation[] {
    return this.operations;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.operations);
    return () => this.listeners.delete(listener);
  }

  /** Loads persisted operations and resumes anything still pending. */
  async start(): Promise<void> {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const raw = await this.deps.store.getItem(STORE_KEY);
        this.operations = raw ? (JSON.parse(raw) as StorageOperation[]) : [];
      } catch {
        this.operations = [];
      }
      this.emit();
    }
    void this.processNext();
  }

  private emit() {
    const snapshot = [...this.operations];
    this.operations = snapshot;
    for (const l of this.listeners) l(snapshot);
  }

  private async save() {
    this.emit();
    try {
      await this.deps.store.setItem(STORE_KEY, JSON.stringify(this.operations));
    } catch {
      // best effort
    }
  }

  private update(id: string, change: (op: StorageOperation) => StorageOperation) {
    this.operations = this.operations.map((op) => (op.id === id ? change(op) : op));
  }

  // Enqueueing

  enqueueDelete(o: { connectionID: string; service: StorageService; bucket: string; region: string; key: string; isFolder: boolean }) {
    this.enqueue("delete", o, `Delete ${o.isFolder ? "folder " : ""}${displayName(o.key)}`);
  }

  enqueueCopy(o: { connectionID: string; service: StorageService; bucket: string; region: string; key: string; isFolder: boolean }) {
    this.enqueue("copy", o, `Copy ${displayName(o.key)}`, duplicateKey(o.key, o.isFolder));
  }

  enqueueRename(o: { connectionID: string; service: StorageService; bucket: string; region: string; key: string; isFolder: boolean; newName: string }) {
    this.enqueue("move", o, `Rename ${displayName(o.key)} → ${o.newName}`, renamedKey(o.key, o.isFolder, o.newName));
  }

  enqueueTransfer(
    kind: "copy" | "move",
    o: { connectionID: string; service: StorageService; bucket: string; region: string; key: string; isFolder: boolean; destinationBucket: string; destinationRegion: string; destinationPrefix: string }
  ) {
    const newKey = o.destinationPrefix + displayName(o.key) + (o.isFolder ? "/" : "");
    const cross = o.destinationBucket !== o.bucket;
    const where = `${cross ? `${o.destinationBucket}/` : ""}${o.destinationPrefix || "/"}`;
    this.enqueue(kind, o, `${kind === "copy" ? "Copy" : "Move"} ${displayName(o.key)} to ${where}`, newKey, cross ? o.destinationBucket : undefined, cross ? o.destinationRegion : undefined);
  }

  /** `files` are already staged to app storage by the caller (uri survives relaunch). */
  enqueueUpload(o: { connectionID: string; service: StorageService; bucket: string; region: string; destinationPrefix: string; files: { fileName: string; uri: string }[] }) {
    if (o.files.length === 0 || this.deps.isDemo?.()) return;
    const label = o.files.length === 1 ? `Upload ${o.files[0]!.fileName}` : `Upload ${o.files.length} files`;
    this.operations = [
      {
        id: this.deps.newId(), connectionID: o.connectionID, service: o.service, bucket: o.bucket, region: o.region,
        kind: "upload", label: label + (o.destinationPrefix ? ` to ${o.destinationPrefix}` : ""),
        items: o.files.map((f) => ({ source: f.uri, destination: o.destinationPrefix + f.fileName, state: "pending" as const })),
        status: "running", createdAt: new Date().toISOString(),
      },
      ...this.operations,
    ];
    void this.save().then(() => this.processNext());
  }

  private enqueue(
    kind: OperationKind,
    o: { connectionID: string; service: StorageService; bucket: string; region: string; key: string; isFolder: boolean },
    label: string,
    newKey?: string,
    destBucket?: string,
    destRegion?: string
  ) {
    // Demo resources don't exist; nothing is ever sent.
    if (this.deps.isDemo?.()) return;
    const op: StorageOperation = {
      id: this.deps.newId(), connectionID: o.connectionID, service: o.service, bucket: o.bucket, region: o.region,
      destBucket, destRegion, kind, label, items: [], status: "running", createdAt: new Date().toISOString(),
    };
    this.operations = [op, ...this.operations];
    void this.save();
    void this.expandAndStart(op.id, o.isFolder ? undefined : [o.key], o.isFolder ? o.key : undefined, (source) => {
      if (newKey === undefined) return undefined;
      return o.isFolder ? newKey + source.slice(o.key.length) : newKey;
    });
  }

  retry(id: string) {
    this.update(id, (op) => ({
      ...op,
      items: op.items.map((i) => (i.state === "failed" ? { ...i, state: "pending" } : i)),
      status: "running",
      errorMessage: undefined,
    }));
    void this.save().then(() => this.processNext());
  }

  clearFinished() {
    for (const op of this.operations) {
      if (isFinished(op) && op.kind === "upload") void this.deps.removeStaged?.(op);
    }
    this.operations = this.operations.filter((op) => !isFinished(op));
    void this.save();
  }

  // Expansion — listing a folder's keys, then the per-key writes.

  private async expandAndStart(id: string, keys: string[] | undefined, prefix: string | undefined, transform: (source: string) => string | undefined) {
    const op = this.operations.find((o) => o.id === id);
    if (!op) return;
    try {
      let sourceKeys = keys ?? [];
      if (!keys && prefix !== undefined) {
        const store = await this.deps.objectStore(op.connectionID, op.service);
        if (!store) throw new Error("No credential for this connection.");
        sourceKeys = await store.listAllKeys(op.bucket, op.region, prefix);
      }
      this.update(id, (o) => ({ ...o, items: sourceKeys.map((s) => ({ source: s, destination: transform(s), state: "pending" as const })) }));
      if (sourceKeys.length === 0) this.update(id, (o) => ({ ...o, status: "completed" }));
      await this.save();
      void this.processNext();
    } catch (error) {
      this.update(id, (o) => ({ ...o, status: "failed", errorMessage: error instanceof Error ? error.message : String(error) }));
      await this.save();
    }
  }

  // Processing — exactly one request in flight.

  private async processNext(): Promise<void> {
    if (this.busy) return;
    const op = this.operations.find((o) => o.status === "running" && o.items.length > 0);
    if (!op) return;
    this.busy = true;
    try {
      await this.step(op);
    } finally {
      this.busy = false;
    }
    void this.processNext();
  }

  private finish(op: StorageOperation) {
    const failed = op.items.some((i) => i.state === "failed");
    this.update(op.id, (o) => ({ ...o, status: failed ? "failed" : "completed" }));
    if (!failed && op.kind === "upload") void this.deps.removeStaged?.(op);
  }

  private mark(id: string, indices: number[], state: ItemState, error?: string) {
    this.update(id, (o) => ({
      ...o,
      items: o.items.map((item, i) => (indices.includes(i) ? { ...item, state } : item)),
      ...(error !== undefined ? { status: "failed" as const, errorMessage: error } : {}),
    }));
  }

  private async step(op: StorageOperation): Promise<void> {
    const store = await this.deps.objectStore(op.connectionID, op.service);
    if (!store) {
      this.update(op.id, (o) => ({ ...o, status: "failed", errorMessage: "No credential for this connection." }));
      await this.save();
      return;
    }
    const destBucket = op.destBucket ?? op.bucket;
    const destRegion = op.destRegion ?? op.region;
    let indices: number[] = [];
    try {
      switch (op.kind) {
        case "delete": {
          indices = op.items.map((_, i) => i).filter((i) => op.items[i]!.state === "pending").slice(0, BATCH_DELETE_CHUNK);
          if (indices.length === 0) return this.finishAndSave(op);
          await store.batchDelete(op.bucket, op.region, indices.map((i) => op.items[i]!.source));
          this.mark(op.id, indices, "done");
          break;
        }
        case "copy": {
          const idx = op.items.findIndex((i) => i.state === "pending");
          if (idx < 0) return this.finishAndSave(op);
          indices = [idx];
          const item = op.items[idx]!;
          await store.copyObject({ sourceBucket: op.bucket, sourceRegion: op.region, sourceKey: item.source, destBucket, destRegion, destKey: item.destination ?? item.source });
          this.mark(op.id, indices, "done");
          break;
        }
        case "move": {
          const idx = op.items.findIndex((i) => i.state === "pending" || i.state === "copied");
          if (idx < 0) return this.finishAndSave(op);
          indices = [idx];
          const item = op.items[idx]!;
          if (item.state === "pending") {
            await store.copyObject({ sourceBucket: op.bucket, sourceRegion: op.region, sourceKey: item.source, destBucket, destRegion, destKey: item.destination ?? item.source });
            this.mark(op.id, indices, "copied");
          } else {
            await store.deleteObject(op.bucket, op.region, item.source);
            this.mark(op.id, indices, "done");
          }
          break;
        }
        case "upload": {
          const idx = op.items.findIndex((i) => i.state === "pending");
          if (idx < 0) return this.finishAndSave(op);
          indices = [idx];
          const item = op.items[idx]!;
          const destKey = item.destination ?? item.source;
          let data: ArrayBuffer | Uint8Array;
          try {
            data = await this.deps.readStaged(item.source);
          } catch {
            this.mark(op.id, indices, "failed", "Couldn't read the staged file");
            break;
          }
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          // Skip identical content: single-PUT ETag is the object's MD5.
          const remote = await store.headETag(op.bucket, op.region, destKey);
          if (remote && remote.toLowerCase() === bytesToHex(md5(bytes))) {
            this.mark(op.id, indices, "done");
            break;
          }
          await store.putObject(op.bucket, op.region, destKey, bytes, this.deps.contentType?.(destKey));
          this.mark(op.id, indices, "done");
          break;
        }
      }
    } catch (error) {
      this.mark(op.id, indices, "failed", error instanceof Error ? error.message : String(error));
    }
    await this.save();
  }

  private async finishAndSave(op: StorageOperation) {
    this.finish(op);
    await this.save();
  }
}
