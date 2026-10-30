import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseInstances, parseStatusChecks } from "../src/aws/ec2.ts";
import { parseQueryError } from "../src/aws/errors.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/aws/${name}`, import.meta.url), "utf8");

test("parses every instance across reservations, with its Name tag", () => {
  const instances = parseInstances(fixture("ec2-describe-instances.xml"));
  expect(instances).toEqual([
    {
      instanceId: "i-1234567890abcdef0",
      instanceType: "t2.micro",
      state: "running",
      name: "web-1",
      launchTime: "2018-05-08T16:46:19.000Z",
    },
    {
      instanceId: "i-0598c7d356eba48d7",
      instanceType: "m6i.large",
      state: "stopped",
      launchTime: "2024-01-15T09:30:00.000Z",
    },
    {
      instanceId: "i-0fedcba9876543210",
      instanceType: "c7g.xlarge",
      state: "pending",
      name: "worker & batch",
      launchTime: "2026-10-29T22:01:05.000Z",
    },
  ]);
});

test("reads system, instance and EBS status checks", () => {
  expect(parseStatusChecks(fixture("ec2-describe-instance-status.xml"))).toEqual({
    system: "ok",
    instance: "impaired",
    ebs: "initializing",
  });
});

test("turns a Query API error body into code and message", () => {
  const error = parseQueryError(403, fixture("error-unauthorized.xml"));
  expect(error.code).toBe("UnauthorizedOperation");
  expect(error.message).toBe("UnauthorizedOperation: You are not authorized to perform this operation.");
});
