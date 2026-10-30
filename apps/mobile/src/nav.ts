// Typed-ish push helpers; objects ride along as JSON route params.
import { router } from "expo-router";
import type { StorageService } from "@cloud-console/core/object-store";

const json = (v: unknown) => JSON.stringify(v);

export const nav = {
  bucket: (id: string, service: StorageService, bucket: string, region: string, prefix = "") =>
    router.push({ pathname: "/c/[id]/bucket", params: { id, service, bucket, region, prefix } }),
  object: (id: string, service: StorageService, bucket: string, region: string, object: unknown) =>
    router.push({ pathname: "/c/[id]/object", params: { id, service, bucket, region, object: json(object) } }),
  destination: (id: string, service: StorageService, bucket: string, region: string, token: string) =>
    router.push({ pathname: "/c/[id]/destination", params: { id, service, bucket, region, token } }),
  ec2: (id: string, instance: unknown, region: string) => router.push({ pathname: "/c/[id]/ec2", params: { id, region, instance: json(instance) } }),
  lambda: (id: string, fn: unknown, region: string) => router.push({ pathname: "/c/[id]/lambda", params: { id, region, fn: json(fn) } }),
  principal: (id: string, kind: "user" | "role", item: unknown) => router.push({ pathname: "/c/[id]/principal", params: { id, kind, item: json(item) } }),
  event: (id: string, item: unknown) => router.push({ pathname: "/c/[id]/event", params: { id, item: json(item) } }),
  parameter: (id: string, parameter: unknown) => router.push({ pathname: "/c/[id]/parameter", params: { id, parameter: json(parameter) } }),
  detail: (id: string, title: string, fields: unknown) => router.push({ pathname: "/c/[id]/detail", params: { id, title, fields: json(fields) } }),
  billingDetail: (id: string, service: unknown, bill: unknown) =>
    router.push({ pathname: "/c/[id]/billing-detail", params: { id, service: json(service), bill: json(bill) } }),
};
