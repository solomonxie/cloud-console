// The connection list (port of HomeStore). Metadata on AsyncStorage, the key
// in the Keychain. Demo mode keeps its own list, seeded from the preset.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { VendorId } from "@cloud-console/core/catalog";
import { createStore } from "./store";
import { isDemo } from "../services/settings";
import { demo } from "../services/demo";
import { deleteSecret, credentialKey, saveCredential, type StoredCredential } from "../services/keychain";

export interface Connection {
  id: string;
  vendor: VendorId;
  name: string;
  addedAt: string; // ISO 8601
}

/** Swift's CloudVendor raw values, used in stored/demo JSON. */
const RAW_TO_ID: Record<string, VendorId> = {
  AWS: "aws", Azure: "azure", "Google Cloud": "gcp", "Tencent Cloud": "tencent", "Alibaba Cloud": "alibaba",
};

const listKey = () => (isDemo() ? "demo.connections.list" : "connections.list");

export const connections = createStore<Connection[]>([]);

function normalize(raw: { id: string; vendor: string; name: string; addedAt: string }): Connection {
  return { id: raw.id, vendor: RAW_TO_ID[raw.vendor] ?? (raw.vendor as VendorId), name: raw.name, addedAt: raw.addedAt };
}

export async function loadConnections(): Promise<void> {
  const raw = await AsyncStorage.getItem(listKey());
  let list: Connection[] = [];
  try {
    list = raw ? (JSON.parse(raw) as Connection[]).map(normalize) : [];
  } catch {
    list = [];
  }
  if (isDemo() && raw === null) {
    list = demo.connections().map(normalize);
    await AsyncStorage.setItem(listKey(), JSON.stringify(list));
  }
  connections.set(list);
}

async function persist(list: Connection[]) {
  connections.set(list);
  await AsyncStorage.setItem(listKey(), JSON.stringify(list));
}

export function newId(): string {
  return demo.newId();
}

export async function addConnection(vendor: VendorId, name: string, credential: StoredCredential): Promise<void> {
  const connection: Connection = { id: newId(), vendor, name, addedAt: new Date().toISOString() };
  if (!isDemo()) await saveCredential(connection.id, credential);
  await persist([...connections.get(), connection]);
}

export async function removeConnection(connection: Connection): Promise<void> {
  if (!isDemo()) await deleteSecret(credentialKey(connection.id));
  await persist(connections.get().filter((c) => c.id !== connection.id));
}

export async function resetDemoConnections(): Promise<void> {
  await AsyncStorage.removeItem("demo.connections.list");
}
