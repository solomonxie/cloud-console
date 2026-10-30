// Credentials live only in the iOS Keychain (expo-secure-store), and only
// ever leave the device inside signed requests to the provider's own API.
import * as SecureStore from "expo-secure-store";

/** Same JSON shape the Swift app stored (`StoredCredential`). */
export type StoredCredential = { keyPair: { id: string; secret: string } } | { single: { _0: string } };

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function credentialKey(connectionID: string): string {
  // SecureStore keys allow [A-Za-z0-9._-] only.
  return `cloud.credential.${connectionID}`;
}

export async function saveSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, options);
}

export async function loadSecret(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch {
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, options);
  } catch {
    // already gone
  }
}

export async function loadCredential(connectionID: string): Promise<StoredCredential | null> {
  const raw = await loadSecret(credentialKey(connectionID));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

export async function saveCredential(connectionID: string, credential: StoredCredential): Promise<void> {
  await saveSecret(credentialKey(connectionID), JSON.stringify(credential));
}
