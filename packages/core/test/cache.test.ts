import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MemoryStore, ResourceCache } from "../src/cache.ts";
import { scanRegions, type RegionalScanState } from "../src/regional.ts";
import { DEFAULT_REGIONS, enabledRegions, sortRegions } from "../src/aws/regions.ts";

const buckets = JSON.parse(readFileSync(new URL("../../demo/aws.json", import.meta.url), "utf8"))["s3-buckets"];

test("serves a hit under the TTL and refetches after it", async () => {
  let clock = 1_000;
  const cache = new ResourceCache(new MemoryStore(), { now: () => clock });
  let fetches = 0;
  const fetch = async () => {
    fetches++;
    return buckets;
  };
  expect(await cache.cached("s3-buckets:aws", 300_000, false, fetch)).toEqual(buckets);
  clock += 299_999;
  await cache.cached("s3-buckets:aws", 300_000, false, fetch);
  expect(fetches).toBe(1);
  clock += 1;
  await cache.cached("s3-buckets:aws", 300_000, false, fetch);
  expect(fetches).toBe(2);
  await cache.cached("s3-buckets:aws", 300_000, true, fetch);
  expect(fetches).toBe(3);
});

test("stale reads survive a fresh instance over the same store; invalidate drops them", async () => {
  const store = new MemoryStore();
  let clock = 0;
  await new ResourceCache(store, { now: () => clock }).set("k", buckets);
  clock = 10 ** 12;
  const second = new ResourceCache(store, { now: () => clock });
  expect(await second.get("k", 300_000)).toBeUndefined();
  expect(await second.stale("k")).toEqual(buckets);
  await second.invalidate("k");
  expect(await second.stale("k")).toBeUndefined();
});

test("scan order: us-east-1, us-west-1, Canada, then the defaults", () => {
  expect(sortRegions(["eu-west-1", "ca-west-1", "us-west-2", "us-west-1", "ca-central-1", "us-east-1", "zz-new-1"])).toEqual([
    "us-east-1", "us-west-1", "ca-central-1", "ca-west-1", "us-west-2", "eu-west-1", "zz-new-1",
  ]);
  expect(enabledRegions(undefined)).toHaveLength(DEFAULT_REGIONS.length);
  expect(enabledRegions([])[0]).toBe("us-east-1");
});

test("scans regions one at a time and keeps failures per region", async () => {
  const cache = new ResourceCache(new MemoryStore());
  const order: string[] = [];
  const states: RegionalScanState<string>[] = [];
  const final = await scanRegions<string>({
    key: (r) => `ec2-instances@${r}:aws`,
    regions: async () => enabledRegions(["eu-west-1", "us-west-1", "us-east-1"]),
    fetch: async (r) => {
      order.push(r);
      if (r === "eu-west-1") throw new Error("AuthFailure: nope");
      return r === "us-east-1" ? ["i-1"] : [];
    },
    cache,
    forceRefresh: false,
    onUpdate: (s) => states.push(s),
  });
  expect(order).toEqual(["us-east-1", "us-west-1", "eu-west-1"]);
  expect(final.scanning).toBeUndefined();
  expect(final.results).toEqual([
    { region: "us-east-1", items: ["i-1"] },
    { region: "us-west-1", items: [] },
    { region: "eu-west-1", items: [], error: "AuthFailure: nope" },
  ]);
  expect(states.some((s) => s.scanning === "us-west-1" && s.scanned === 1)).toBe(true);
});
