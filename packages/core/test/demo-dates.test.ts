import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { demoDate, isoWithOffset, jsonifyDates, resolveDemo } from "../src/demo/dates.ts";
import { DemoCloud } from "../src/demo/cloud.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const tokens = read("./fixtures/demo-tokens.json");

// Local time, like Swift's Calendar.current: Oct 30 2026, 2:00 PM.
const now = new Date(2026, 9, 30, 14, 0, 0);

test("expands every token shape in the fixture", () => {
  const out = resolveDemo(tokens, now) as Record<string, unknown>;
  expect(out.launchTime).toEqual(new Date(2026, 9, 27, 10, 0));
  expect(out.creationDate).toEqual(new Date(2026, 9, 30 - 612, 9, 14));
  expect(out.periodStart).toBe("2026-08-01");
  expect(out.periodEnd).toBe("2026-10-30");
  expect(out.nextMonth).toBe("2026-11-01");
  expect(out.objectKey).toBe("backups/2026-10-27/db.sql.gz");
  expect(out.twoTokens).toBe("logs/2026-09-01..2026-10-30");
  expect(out.unknownToken).toBe("keep {yesterday} as is");
  expect(out.notAToken).toBe("@ymd sometime");
  expect(out.plain).toBe("@admin");
  expect(out.number).toBe(42);
  expect(out.nested).toEqual([{ at: new Date(2026, 9, 31, 7, 5) }]);
});

test("@iso keeps the local offset, in Lambda's LastModified shape", () => {
  const out = resolveDemo(tokens, now) as Record<string, string>;
  expect(out.lastModified).toMatch(/^2026-10-21T15:22:00\.000[+-]\d{4}$/);
  expect(out.lastModified).toBe(isoWithOffset(new Date(2026, 9, 21, 15, 22)));
  expect(new Date(out.lastModified!.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime()).toBe(
    new Date(2026, 9, 21, 15, 22).getTime()
  );
});

test("month offsets land on the first of the month across year ends", () => {
  expect(demoDate("month-10", now)).toEqual(new Date(2025, 11, 1));
  expect(demoDate("month+3 08:30", now)).toEqual(new Date(2027, 0, 1, 8, 30));
  expect(demoDate("week-1", now)).toBeUndefined();
});

test("resolved dates serialize to ISO strings for the models", () => {
  const out = jsonifyDates(resolveDemo({ at: "@today 00:00" }, now)) as { at: string };
  expect(out.at).toBe(new Date(2026, 9, 30).toISOString());
});

const demo = new DemoCloud(
  {
    connections: read("../../demo/connections.json"),
    aws: read("../../demo/aws.json"),
    tencent: read("../../demo/tencent.json"),
  },
  () => now
);

test("demo connections come from connections.json with resolved dates", () => {
  const connections = demo.connections();
  expect(connections.map((c) => c.vendor)).toEqual(["AWS", "Tencent Cloud"]);
  expect(connections[0]!.addedAt).toBe(new Date(2026, 9, 30 - 142, 10, 24).toISOString());
});

test("demo values resolve by cache key, regional or not", () => {
  const ec2 = demo.value<{ instanceId: string }[]>("ec2-instances@us-east-1:aws");
  expect(ec2.length).toBeGreaterThan(0);
  expect(demo.value<unknown[]>("ec2-instances@me-south-1:aws")).toEqual([]);
  const mtd = demo.value<{ periodStart: string }>("billing-mtd:aws");
  expect(mtd.periodStart).toBe("2026-10-01");
  // Suffixed keys (billing history month) still resolve.
  expect(demo.value<unknown[]>("billing-history:tencent:2026-10").length).toBeGreaterThan(0);
  expect(() => demo.value("nope:aws")).toThrow("Not available in demo mode.");
});
