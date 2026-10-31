// Object detail sheet: metadata, inline preview (image/video/audio/PDF),
// and inline editing of text/code/Markdown files with save-back.
import { isTooLargeForTextPreview, mimeForName, previewKind } from "@cloud-console/core/storage/preview";
import { formatSize } from "@cloud-console/core/storage/format";
import type { StorageObject } from "@cloud-console/core/storage/types";
import { icon, iconForFileName } from "../lib/icons.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { deleteObject, downloadObject } from "./browser.ts";
import { setClipboard } from "./clipboard.ts";
import { confirmDialog } from "./dialogs.ts";
import { els, formatDate, withStatus } from "./dom.ts";
import { openShareMenu } from "./share.ts";
import { open } from "./state.ts";

interface EditorState {
  key: string;
  mimeType: string;
  original: string;
  el: HTMLTextAreaElement;
}

let editorState: EditorState | null = null; // while a text/markdown file is open

// Opens the object in a new tab via a short-lived signed link, so the
// browser streams it directly (no size limit, unlike the inline preview).
// GCS with gcloud user credentials can't sign; storage.cloud.google.com
// serves the object to the browser's own signed-in Google account instead.
async function openInNewTab(key: string): Promise<void> {
  const { client, bucket } = open();
  try {
    const url = client.canPresign
      ? await withStatus(client.presignedUrl(bucket, key, 3600), "Signing link…")
      : `https://storage.cloud.google.com/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    await chrome.tabs.create({ url });
  } catch {
    // withStatus already surfaced the error
  }
}

export function isEditorDirty(): boolean {
  return !!editorState && editorState.el.value !== editorState.original;
}

function markEditorDirty(): void {
  const dirty = isEditorDirty();
  els.detailSaveBtn.disabled = !dirty;
  els.detailSaveBtn.classList.toggle("dirty", dirty);
}

export async function saveEditor(): Promise<void> {
  if (!editorState) return;
  const text = editorState.el.value;
  try {
    const { client, bucket } = open();
    await withStatus(client.putObject(bucket, editorState.key, new Blob([text]), editorState.mimeType), "Saving…");
    editorState.original = text;
    markEditorDirty();
  } catch {
    // withStatus already surfaced the error
  }
}

// Blob URL behind the current media preview, if it isn't a presigned URL —
// revoked when the next preview replaces it.
let previewBlobUrl: string | null = null;

async function renderDetailPreview(obj: StorageObject, name: string): Promise<void> {
  els.detailPreview.innerHTML = "";
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }
  els.detailSaveBtn.hidden = true;
  els.detailSaveBtn.disabled = true;
  els.detailSaveBtn.classList.remove("dirty");
  editorState = null;

  const kind = previewKind(name);
  if (!kind) return;
  const { client, bucket } = open();

  if (kind === "image" || kind === "video" || kind === "audio" || kind === "pdf") {
    let url: string;
    try {
      // A presigned URL lets the browser fetch it directly — native Range
      // requests for video/audio scrubbing, no need to buffer the file in JS.
      // Clients that can't sign (GCS with gcloud user credentials) download
      // it into a blob URL instead.
      if (!client.canPresign) {
        const blob = await client.getObjectBlob(bucket, obj.key);
        url = URL.createObjectURL(new Blob([blob], { type: mimeForName(name) }));
        previewBlobUrl = url;
      } else {
        url = await client.presignedUrl(bucket, obj.key, 3600);
      }
    } catch (err) {
      console.error(err);
      return;
    }
    if (kind === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = name;
      els.detailPreview.appendChild(img);
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      els.detailPreview.appendChild(video);
    } else if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      els.detailPreview.appendChild(audio);
    } else {
      const iframe = document.createElement("iframe");
      iframe.className = "pdf-frame";
      iframe.src = url;
      els.detailPreview.appendChild(iframe);
      const fallback = document.createElement("div");
      fallback.className = "preview-fallback";
      fallback.append("Not rendering? ");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open in a new tab";
      fallback.append(link, ".");
      els.detailPreview.appendChild(fallback);
    }
    return;
  }

  // text / markdown: fetch the object and show it as an editable source,
  // with a rendered-preview toggle for markdown.
  if (isTooLargeForTextPreview(obj.size)) {
    const note = document.createElement("div");
    note.className = "preview-fallback";
    note.textContent = `File is ${formatSize(obj.size)} — too large to preview/edit here. Use Download instead.`;
    els.detailPreview.appendChild(note);
    return;
  }

  let text: string;
  try {
    const blob = await withStatus(client.getObjectBlob(bucket, obj.key), "Loading preview…");
    text = await blob.text();
  } catch {
    return; // withStatus already surfaced the error
  }

  const editor = document.createElement("textarea");
  editor.className = "detail-editor";
  editor.value = text;
  editor.spellcheck = false;
  editor.addEventListener("input", markEditorDirty);

  editorState = { key: obj.key, mimeType: mimeForName(name), original: text, el: editor };
  els.detailSaveBtn.hidden = false;

  if (kind === "markdown") {
    const toolbar = document.createElement("div");
    toolbar.className = "preview-toolbar";
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "btn";
    previewBtn.textContent = "Preview";
    const sourceBtn = document.createElement("button");
    sourceBtn.type = "button";
    sourceBtn.className = "btn";
    sourceBtn.textContent = "Source";
    const rendered = document.createElement("div");
    rendered.className = "markdown-preview";

    const showPreview = () => {
      rendered.innerHTML = renderMarkdown(editor.value);
      rendered.hidden = false;
      editor.hidden = true;
      previewBtn.classList.add("active");
      sourceBtn.classList.remove("active");
    };
    const showSource = () => {
      rendered.hidden = true;
      editor.hidden = false;
      sourceBtn.classList.add("active");
      previewBtn.classList.remove("active");
    };
    previewBtn.addEventListener("click", showPreview);
    sourceBtn.addEventListener("click", showSource);
    toolbar.append(previewBtn, sourceBtn);
    els.detailPreview.append(toolbar, rendered, editor);
    showPreview();
  } else {
    els.detailPreview.appendChild(editor);
  }
}

export async function closeDetailModal(): Promise<void> {
  if (isEditorDirty()) {
    const ok = await confirmDialog({
      title: "Discard changes?",
      message: "Your edits haven't been saved.",
      confirmLabel: "Discard",
    });
    if (!ok) return;
  }
  els.detailModal.close();
}

export function openObjectDetail(obj: StorageObject, name: string): void {
  els.detailIcon.innerHTML = icon(iconForFileName(name));
  els.detailName.textContent = name;
  els.detailMeta.innerHTML = "";
  const rows: [string, string][] = [
    ["Key", obj.key],
    ["Size", formatSize(obj.size)],
    ["Last modified", formatDate(obj.lastModified) || obj.lastModified || "—"],
  ];
  if (obj.storageClass) rows.push(["Storage class", obj.storageClass]);
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.detailMeta.append(dt, dd);
  }
  const item = { key: obj.key, isFolder: false };
  els.detailShareBtn.onclick = () => openShareMenu(obj.key, name);
  els.detailDownloadBtn.onclick = () => {
    els.detailModal.close();
    void downloadObject(obj.key, name);
  };
  els.detailOpenBtn.onclick = () => void openInNewTab(obj.key);
  els.detailCopyBtn.onclick = () => {
    els.detailModal.close();
    setClipboard([item], false);
  };
  els.detailMoveBtn.onclick = () => {
    els.detailModal.close();
    setClipboard([item], true);
  };
  els.detailDeleteBtn.onclick = () => {
    els.detailModal.close();
    void deleteObject(obj.key);
  };
  els.detailModal.showModal();
  void renderDetailPreview(obj, name);
}
