// A Google Cloud account can point at a credentials file on disk (usually
// gcloud's ~/.config/gcloud/application_default_credentials.json) instead
// of holding a pasted copy. The file is picked once; its handle is kept in
// IndexedDB (handles can't go in chrome.storage) and the file is re-read
// every time the account is used, so a `gcloud auth application-default
// login` is picked up without touching the extension. Chrome asks for read
// permission again each session — its prompt offers "Allow on every visit"
// to stop asking. The contents are never written anywhere.

// File System Access bits the TS DOM lib doesn't declare yet.
type PermissionMode = { mode: "read" };
interface CredentialsFileHandle extends FileSystemFileHandle {
  queryPermission(opts: PermissionMode): Promise<PermissionState>;
  requestPermission(opts: PermissionMode): Promise<PermissionState>;
}
declare global {
  interface Window {
    showOpenFilePicker?(opts: {
      types?: { description: string; accept: Record<string, string[]> }[];
      excludeAcceptAllOption?: boolean;
      id?: string;
    }): Promise<FileSystemFileHandle[]>;
  }
}

import { h, icon } from "./dom.ts";

export const ADC_PATH = "~/.config/gcloud/application_default_credentials.json";

const DB = "gcpCredentialFiles";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function saveHandle(accountId: string, handle: FileSystemFileHandle): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(handle, accountId));
}

export function getHandle(accountId: string): Promise<CredentialsFileHandle | undefined> {
  return tx("readonly", (s) => s.get(accountId) as IDBRequest<CredentialsFileHandle | undefined>);
}

export async function deleteHandle(accountId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(accountId));
}

// Opens the picker (needs a click). macOS hides ~/.config; ⌘⇧G in the
// picker takes a typed path. `id` makes Chrome reopen the same folder next
// time.
export async function pickCredentialsFile(): Promise<FileSystemFileHandle | null> {
  if (!window.showOpenFilePicker) throw new Error("This version of Chrome can't link files — load the file's contents instead.");
  try {
    const [handle] = await window.showOpenFilePicker({
      id: "gcp-credentials",
      types: [{ description: "Credentials JSON", accept: { "application/json": [".json"] } }],
    });
    return handle ?? null;
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return null; // picker cancelled
    throw err;
  }
}

export async function readHandle(handle: FileSystemFileHandle): Promise<string> {
  return (await (await handle.getFile()).text()).trim();
}

export type LinkedRead =
  | { kind: "ok"; json: string }
  | { kind: "needsPermission"; fileName: string; request: () => Promise<LinkedRead> }
  | { kind: "missing" };

// Reads the linked file if read permission is already granted; otherwise
// returns a `request` to call from a click (Chrome only prompts on a user
// gesture).
export async function readLinkedFile(accountId: string): Promise<LinkedRead> {
  const handle = await getHandle(accountId);
  if (!handle) return { kind: "missing" };
  const read = async (): Promise<LinkedRead> => {
    try {
      return { kind: "ok", json: await readHandle(handle) };
    } catch (err) {
      if ((err as DOMException)?.name === "NotFoundError") {
        throw new Error(`${handle.name} is gone — re-run \`gcloud auth application-default login\`, or link the file again.`);
      }
      throw err;
    }
  };
  if ((await handle.queryPermission({ mode: "read" })) === "granted") return read();
  return {
    kind: "needsPermission",
    fileName: handle.name,
    request: async () => {
      const state = await handle.requestPermission({ mode: "read" });
      if (state !== "granted") throw new Error(`Chrome wasn't allowed to read ${handle.name}.`);
      return read();
    },
  };
}

// The account's credentials JSON: the pasted copy, or the linked file read
// fresh. When Chrome needs the user's OK first, an "Allow" button is shown
// in `slot` and the promise waits for that click.
export async function credentialsFor(account: { id: string; credentialsJson: string; credentialsFile?: string }, slot: HTMLElement): Promise<string> {
  if (!account.credentialsFile) return account.credentialsJson;
  const first = await readLinkedFile(account.id);
  if (first.kind === "ok") return first.json;
  if (first.kind === "missing") throw new Error("The linked credentials file isn't set up on this browser — edit the account and link it again.");
  return new Promise((resolve, reject) => {
    const allow = h("button", { type: "button", class: "btn primary" }, icon("key"), `Allow reading ${first.fileName}`);
    allow.addEventListener("click", async () => {
      allow.disabled = true;
      try {
        const r = await first.request();
        slot.replaceChildren();
        if (r.kind === "ok") resolve(r.json);
        else reject(new Error(`Couldn't read ${first.fileName}.`));
      } catch (err) {
        allow.disabled = false;
        reject(err);
      }
    });
    slot.replaceChildren(
      h(
        "div",
        { class: "empty-state gcp-file-permission" },
        icon("key"),
        h("div", { class: "primary" }, "Read the latest credentials?"),
        h("div", {}, `This account uses ${ADC_PATH.endsWith(first.fileName) ? ADC_PATH : first.fileName}, read fresh each time. Choose “Allow on every visit” in Chrome's prompt to stop being asked.`),
        allow
      )
    );
  });
}
