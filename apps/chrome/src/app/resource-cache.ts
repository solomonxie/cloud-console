// Read-only listings for the kind screens, cached like the mobile app's
// (packages/core/src/cache.ts ResourceCache) in chrome.storage.session:
// reopening a screen is instant, nothing survives a browser restart, and
// keys carry only the connection id — never a credential.
import { ResourceCache, type KeyValueStore } from "@cloud-console/core/cache";

const sessionStore: KeyValueStore = {
  async getItem(key) {
    const got = await chrome.storage.session.get(key);
    return (got[key] as string | undefined) ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.session.remove(key);
  },
};

export const resourceCache = new ResourceCache(sessionStore, { prefix: "kinds/" });
