// Clipboard-style copy/cut/paste of files and folders, within one
// connection (server-side copies can't cross accounts/providers).
import { els, errorMessage, plural, setStatus } from "./dom.ts";
import { refresh } from "./browser.ts";
import { open, state, type Item } from "./state.ts";

export function setClipboard(items: Item[], cut: boolean): void {
  if (!items.length || !state.bucket) return;
  state.clipboard = { items, cut, bucket: state.bucket, connectionId: state.conn?.id ?? null };
  updateClipboardUI();
  setStatus(`${plural(items.length, "item")} ${cut ? "cut" : "copied"} — open a folder and click Paste.`);
}

export function clearClipboard(): void {
  state.clipboard = null;
  updateClipboardUI();
}

export function updateClipboardUI(): void {
  const cb = state.clipboard;
  els.clipboardPill.hidden = !cb;
  if (cb) {
    els.clipboardCount.textContent = `${plural(cb.items.length, "item")} ${cb.cut ? "cut" : "copied"}`;
  }
  const mismatched = !!cb && cb.connectionId !== (state.conn?.id ?? null);
  els.pasteBtn.disabled = !cb || mismatched || !state.bucket;
  els.pasteBtn.title = mismatched ? "Clipboard has items from a different connection" : "Paste";
}

export async function pasteClipboard(): Promise<void> {
  const cb = state.clipboard;
  if (!cb || els.pasteBtn.disabled) return;
  let pasted = 0;
  let skipped = 0;
  try {
    const { client, bucket } = open();
    setStatus(`Pasting ${cb.items.length} item(s)…`, { loading: true });
    for (const item of cb.items) {
      const base = item.key.replace(/\/$/, "").split("/").pop();
      const destKey = state.prefix + base + (item.isFolder ? "/" : "");
      // Refuse a no-op paste (same spot) or nesting a folder inside itself.
      if (destKey === item.key || (item.isFolder && state.prefix.startsWith(item.key))) {
        skipped += 1;
        continue;
      }
      if (item.isFolder) {
        await client.copyPrefix(bucket, destKey, cb.bucket, item.key);
        if (cb.cut) await client.deletePrefix(cb.bucket, item.key);
      } else {
        await client.copyObject(bucket, destKey, cb.bucket, item.key);
        if (cb.cut) await client.deleteObject(cb.bucket, item.key);
      }
      pasted += 1;
    }
    setStatus(skipped ? `Pasted ${pasted}, skipped ${skipped} (already here).` : `Pasted ${pasted} item(s).`);
    if (cb.cut && pasted > 0) clearClipboard(); // cut items move once; copy stays for repeat pastes
    await refresh();
  } catch (err) {
    console.error(err);
    setStatus(errorMessage(err), { error: true });
  }
}
