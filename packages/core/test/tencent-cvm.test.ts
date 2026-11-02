import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseRegions } from "../src/tencent/cvm.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tencent/${name}`, import.meta.url), "utf8"));

test("keeps only available CVM regions, in Tencent's order", () => {
  expect(parseRegions(fixture("cvm-describe-regions.json").Response)).toEqual(["ap-guangzhou", "ap-shanghai", "na-siliconvalley"]);
});

