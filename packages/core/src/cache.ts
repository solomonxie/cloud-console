// Disk-backed, TTL-checked cache for read-only resource listings (port of
// ResourceCache.swift), storage-agnostic: the app supplies a KeyValueStore
// (AsyncStorage on mobile, chrome.storage in the extension). Not for writes —
// the operation queue keeps its own persistence.

/** Default freshness window — reopening a screen minutes later is instant. */
export const DEFAULT_RESOURCE_TTL = 300_000; // ms
/** Cost Explorer charges per request; drill-downs keep longer. */
export const COST_DETAIL_TTL = 3_600_000;

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface Entry {
  savedAt: number;
  value: unknown;
}

export class ResourceCache {
  private readonly memory = new Map<string, Entry>();
  private readonly store: KeyValueStore;
  private readonly prefix: string;
  private readonly now: () => number;

  constructor(store: KeyValueStore, opts: { prefix?: string; now?: () => number } = {}) {
    this.store = store;
    this.prefix = opts.prefix ?? "ResourceCache/";
    this.now = opts.now ?? Date.now;
  }

  private storageKey(key: string): string {
    return this.prefix + encodeURIComponent(key);
  }

  private async entry(key: string): Promise<Entry | undefined> {
    const hit = this.memory.get(key);
    if (hit) return hit;
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(this.storageKey(key));
    } catch {
      return undefined;
    }
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as Entry;
      if (typeof entry?.savedAt !== "number") return undefined;
      this.memory.set(key, entry);
      return entry;
    } catch {
      return undefined;
    }
  }

  /** The cached value if younger than `ttl` ms; otherwise undefined (a miss, not an error). */
  async get<T>(key: string, ttl: number): Promise<T | undefined> {
    const entry = await this.entry(key);
    if (!entry) return undefined;
    if (this.now() - entry.savedAt >= ttl) return undefined;
    return entry.value as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    const entry: Entry = { savedAt: this.now(), value };
    this.memory.set(key, entry);
    try {
      await this.store.setItem(this.storageKey(key), JSON.stringify(entry));
    } catch {
      // Cache is best-effort.
    }
  }

  /** Drop an entry after a write so the next load doesn't serve a stale listing. */
  async invalidate(key: string): Promise<void> {
    this.memory.delete(key);
    try {
      await this.store.removeItem(this.storageKey(key));
    } catch {
      // ignore
    }
  }

  /** Cached hit under `ttl` unless `forceRefresh`; otherwise fetch and cache. */
  async cached<T>(key: string, ttl: number, forceRefresh: boolean, fetch: () => Promise<T>): Promise<T> {
    if (!forceRefresh) {
      const hit = await this.get<T>(key, ttl);
      if (hit !== undefined) return hit;
    }
    const value = await fetch();
    await this.set(key, value);
    return value;
  }

  /** Last cached value regardless of age — shown while a fresh fetch runs. */
  stale<T>(key: string): Promise<T | undefined> {
    return this.get<T>(key, Number.POSITIVE_INFINITY);
  }
}

/** In-memory store for tests and for demo/ephemeral use. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}
