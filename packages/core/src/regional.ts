// Multi-region scanning (port of RegionalResourceStore's run loop): shows the
// last cached result per region first, then rescans every enabled region one
// at a time in scan order, reporting each region as soon as it's done.
import type { ResourceCache } from "./cache.ts";
import { DEFAULT_RESOURCE_TTL } from "./cache.ts";

export interface RegionResult<T> {
  region: string;
  items: T[];
  error?: string;
}

export interface RegionalScanState<T> {
  results: RegionResult<T>[];
  /** "regions" while resolving the region list, a region while scanning it, undefined when done. */
  scanning?: string;
  scanned: number;
  regionCount: number;
}

export interface RegionalScanOptions<T> {
  /** Cache key per region: `<kind>@<region>:<key id>`. */
  key: (region: string) => string;
  regions: () => Promise<string[]>;
  fetch: (region: string) => Promise<T[]>;
  cache: Pick<ResourceCache, "cached" | "stale">;
  forceRefresh: boolean;
  previous?: RegionResult<T>[];
  onUpdate: (state: RegionalScanState<T>) => void;
  isCancelled?: () => boolean;
  ttl?: number;
}

function upsert<T>(results: RegionResult<T>[], result: RegionResult<T>, order: string[]): RegionResult<T>[] {
  const out = [...results];
  const index = out.findIndex((r) => r.region === result.region);
  if (index >= 0) {
    out[index] = result;
    return out;
  }
  const pos = (r: string) => {
    const i = order.indexOf(r);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const insertAt = out.findIndex((r) => pos(r.region) > pos(result.region));
  if (insertAt < 0) out.push(result);
  else out.splice(insertAt, 0, result);
  return out;
}

export async function scanRegions<T>(opts: RegionalScanOptions<T>): Promise<RegionalScanState<T>> {
  const cancelled = opts.isCancelled ?? (() => false);
  let state: RegionalScanState<T> = { results: opts.previous ?? [], scanning: "regions", scanned: 0, regionCount: 0 };
  opts.onUpdate(state);

  const regions = await opts.regions();
  state = { ...state, regionCount: regions.length };
  if (state.results.length === 0) {
    const results: RegionResult<T>[] = [];
    for (const region of regions) {
      const items = await opts.cache.stale<T[]>(opts.key(region));
      if (items) results.push({ region, items });
    }
    state = { ...state, results };
  }
  opts.onUpdate(state);

  for (let index = 0; index < regions.length; index++) {
    if (cancelled()) return state;
    const region = regions[index]!;
    state = { ...state, scanning: region, scanned: index };
    opts.onUpdate(state);
    const result: RegionResult<T> = { region, items: state.results.find((r) => r.region === region)?.items ?? [] };
    try {
      result.items = await opts.cache.cached(opts.key(region), opts.ttl ?? DEFAULT_RESOURCE_TTL, opts.forceRefresh, () => opts.fetch(region));
    } catch (error) {
      if (cancelled()) return state;
      result.error = error instanceof Error ? error.message : String(error);
    }
    state = { ...state, results: upsert(state.results, result, regions) };
    opts.onUpdate(state);
  }
  state = { ...state, results: state.results.filter((r) => regions.includes(r.region)), scanning: undefined };
  opts.onUpdate(state);
  return state;
}
