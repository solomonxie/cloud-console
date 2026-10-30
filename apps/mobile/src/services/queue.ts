// The app's single object-storage operation queue (S3OperationQueue port),
// persisted on AsyncStorage; uploads are staged into app storage first so
// they survive a relaunch.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { OperationQueue, type StorageOperation } from "@cloud-console/core/operation-queue";
import type { StorageService } from "@cloud-console/core/object-store";
import { connections, newId } from "../state/connections";
import { objectStore, openSession } from "./cloud";
import { loadCredential } from "./keychain";
import { isDemo } from "./settings";

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", heic: "image/heic", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  json: "application/json", html: "text/html", css: "text/css", js: "text/javascript", zip: "application/zip",
  svg: "image/svg+xml", xml: "application/xml", md: "text/markdown",
};

export function contentType(key: string): string | undefined {
  const ext = key.split(".").pop()?.toLowerCase();
  return ext && ext !== key.toLowerCase() ? MIME[ext] : undefined;
}

export const queue = new OperationQueue({
  store: AsyncStorage,
  isDemo,
  newId,
  contentType,
  async objectStore(connectionID: string, service: StorageService) {
    // Keychain-backed, so a resumed operation finds its own key without Home.
    const connection = connections.get().find((c) => c.id === connectionID);
    if (!connection) {
      const stored = await loadCredential(connectionID);
      if (!stored) return undefined;
    }
    const session = await openSession(connection ?? { id: connectionID, vendor: service === "cos" ? "tencent" : "aws", name: "", addedAt: "" });
    if (!session.id) return undefined;
    return objectStore(session, service);
  },
  async readStaged(uri: string) {
    return new File(uri).bytes();
  },
  async removeStaged(op: StorageOperation) {
    for (const item of op.items) {
      try {
        new File(item.source).delete();
      } catch {
        // already gone
      }
    }
  },
});

/** Copies picked files into the app's own storage, then enqueues the upload. */
export async function stageAndUpload(
  target: { connectionID: string; service: StorageService; bucket: string; region: string; destinationPrefix: string },
  picked: { uri: string; fileName: string }[]
): Promise<void> {
  if (isDemo() || picked.length === 0) return;
  const staging = new Directory(Paths.document, "s3-uploads", newId());
  staging.create({ intermediates: true, idempotent: true });
  const files: { fileName: string; uri: string }[] = [];
  for (const p of picked) {
    const dest = new File(staging, newId());
    await new File(p.uri).copy(dest);
    files.push({ fileName: p.fileName, uri: dest.uri });
  }
  queue.enqueueUpload({ ...target, files });
}
