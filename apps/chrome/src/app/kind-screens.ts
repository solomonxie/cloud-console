// Screens for a connection's non-storage resource kinds (EC2, Lambda, CVM,
// …). A vendor module registers one factory per kind at import time; Home
// shows a kind's row only when the catalog marks it implemented for Chrome
// AND a factory is registered, so nothing appears before it exists.
import type { ResourceKindId, VendorId } from "@cloud-console/core/catalog";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import type { Screen } from "./nav.ts";

// The connection's own key (accessKeyId/secretAccessKey, and region where
// the vendor has one) is all a screen may use.
export type KindScreenFactory = (conn: StorageConnection) => Screen;

// Keyed by vendor too: a kind id can be shared across vendors ("billing" is
// both AWS's and Tencent's).
const factories = new Map<string, KindScreenFactory>();

export function registerKindScreen(vendor: VendorId, kind: ResourceKindId, factory: KindScreenFactory): void {
  const key = `${vendor}:${kind}`;
  if (factories.has(key)) throw new Error(`Screen for "${key}" is already registered`);
  factories.set(key, factory);
}

export function kindScreen(vendor: VendorId, kind: ResourceKindId): KindScreenFactory | undefined {
  return factories.get(`${vendor}:${kind}`);
}
