import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseMembers } from "../src/aws/iam.ts";

const xml = readFileSync(new URL("./fixtures/aws/iam-list-users.xml", import.meta.url), "utf8");

test("parses IAM <Users><member> lists", () => {
  const users = parseMembers(xml, "Users", (f) => ({ name: f.UserName, path: f.Path, created: f.CreateDate }));
  expect(users).toEqual([
    { name: "Andrew", path: "/division_abc/subdivision_xyz/engineering/", created: "2012-09-05T19:38:48Z" },
    { name: "Jackie", path: "/division_abc/subdivision_xyz/engineering/", created: "2014-04-09T15:43:45Z" },
  ]);
});
