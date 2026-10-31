// The bucket browser as a navigation screen. Its markup lives in
// <template id="storageTemplate"> in sidepanel.html and is cloned into the
// screen's body on every push; the static dialogs it shares (connection
// form, confirm/prompt, share, object detail) are wired once at boot by
// initBucketBrowser().
import { createClient } from "@cloud-console/core/storage/client";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import type { Screen } from "../app/nav.ts";
import { icon } from "../lib/icons.ts";
import { filterBox } from "../ui/search.ts";
import { bulkDelete, createFolder, loadMore, refresh, renderBreadcrumb, setFilter, setSelectMode, syncRowCheckboxes, updateSelectionBar, uploadFiles } from "./browser.ts";
import { clearClipboard, pasteClipboard, setClipboard, updateClipboardUI } from "./clipboard.ts";
import { isStored, openConnectionModal, wireConnections } from "./connections.ts";
import { closeOnBackdropClick } from "./dialogs.ts";
import { els, errorMessage, initDialogEls, initScreenEls, setStatus } from "./dom.ts";
import { closeDetailModal, isEditorDirty, saveEditor } from "./preview.ts";
import { wireShare } from "./share.ts";
import { state } from "./state.ts";

// --- Once, at boot -----------------------------------------------------------

function fillDialogIcons(): void {
  els.toggleSecretBtn.innerHTML = icon("eye");
  els.copyS3UriBtn.innerHTML = icon("copy");
  els.copyHttpUrlBtn.innerHTML = icon("copy");
  els.copySignedUrlBtn.innerHTML = icon("copy");
  els.detailCloseBtn.innerHTML = icon("x");
  els.detailSaveBtn.innerHTML = icon("save");
  els.detailShareBtn.innerHTML = icon("share");
  els.detailDownloadBtn.innerHTML = icon("download");
  els.detailOpenBtn.innerHTML = icon("external");
  els.detailCopyBtn.innerHTML = icon("copy");
  els.detailMoveBtn.innerHTML = icon("scissors");
  els.detailDeleteBtn.innerHTML = icon("trash");
  const labels: [HTMLButtonElement, string][] = [
    [els.detailShareBtn, "Share"],
    [els.detailDownloadBtn, "Download"],
    [els.detailOpenBtn, "Open in new tab (signed link)"],
    [els.detailCopyBtn, "Copy"],
    [els.detailMoveBtn, "Cut"],
    [els.detailSaveBtn, "Save changes"],
    [els.detailDeleteBtn, "Delete"],
  ];
  for (const [btn, label] of labels) {
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

function wireDetail(): void {
  els.detailSaveBtn.addEventListener("click", () => void saveEditor());
  els.detailCloseBtn.addEventListener("click", () => void closeDetailModal());
  // Escape triggers the dialog's native "cancel" first — gate it the same way
  // as the close button so unsaved edits aren't lost silently.
  els.detailModal.addEventListener("cancel", (e) => {
    if (isEditorDirty()) {
      e.preventDefault();
      void closeDetailModal();
    }
  });
  closeOnBackdropClick(els.detailModal, () => void closeDetailModal());
  closeOnBackdropClick(els.shareModal);
}

// Looks up and wires the static dialogs in sidepanel.html. Call once.
export function initBucketBrowser(): void {
  initDialogEls();
  fillDialogIcons();
  wireConnections();
  wireShare();
  wireDetail();
}

// --- Per push ----------------------------------------------------------------

// The template's icon-only controls: filled in per mount so sidepanel.html
// stays markup-only.
function fillScreenIcons(): void {
  els.refreshBtn.innerHTML = icon("refresh");
  els.pasteBtn.innerHTML = icon("clipboard");
  els.clipboardIcon.innerHTML = icon("clipboard");
  els.clipboardClearBtn.innerHTML = icon("x");
  els.newFolderBtn.innerHTML = `${icon("folderPlus")}<span>New folder</span>`;
  els.uploadBtn.innerHTML = `${icon("upload")}<span>Upload</span>`;
  els.selectModeBtn.innerHTML = icon("checkSquare");
  els.bulkCopyBtn.innerHTML = icon("copy");
  els.bulkMoveBtn.innerHTML = icon("move");
  els.bulkDeleteBtn.innerHTML = icon("trash");
  els.exitSelectBtn.innerHTML = icon("x");
}

function wireScreen(): void {
  // Drag and drop upload
  els.fileList.addEventListener("dragover", (e) => {
    if (!state.bucket) return;
    e.preventDefault();
    els.fileList.classList.add("drag-over");
  });
  els.fileList.addEventListener("dragleave", () => els.fileList.classList.remove("drag-over"));
  els.fileList.addEventListener("drop", async (e) => {
    e.preventDefault();
    els.fileList.classList.remove("drag-over");
    const files = e.dataTransfer?.files;
    if (!state.bucket || !files?.length) return;
    await uploadFiles([...files]);
  });

  els.refreshBtn.addEventListener("click", () => void refresh());
  els.loadMoreBtn.addEventListener("click", () => void loadMore(false));
  els.newFolderBtn.addEventListener("click", () => void createFolder());

  els.selectModeBtn.addEventListener("click", () => setSelectMode(!state.selectMode));
  els.exitSelectBtn.addEventListener("click", () => setSelectMode(false));
  els.selectAllCheckbox.addEventListener("change", () => {
    state.selected = els.selectAllCheckbox.checked
      ? new Map(state.listedItems.map((i) => [i.key, i]))
      : new Map();
    updateSelectionBar();
    syncRowCheckboxes();
  });
  els.bulkDeleteBtn.addEventListener("click", () => void bulkDelete());
  els.bulkCopyBtn.addEventListener("click", () => {
    setClipboard([...state.selected.values()], false);
    setSelectMode(false);
  });
  els.bulkMoveBtn.addEventListener("click", () => {
    setClipboard([...state.selected.values()], true);
    setSelectMode(false);
  });
  els.pasteBtn.addEventListener("click", () => void pasteClipboard());
  els.clipboardClearBtn.addEventListener("click", () => {
    clearClipboard();
    setStatus("");
  });
  els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
  els.uploadInput.addEventListener("change", async () => {
    const files = [...(els.uploadInput.files ?? [])];
    els.uploadInput.value = "";
    if (files.length) await uploadFiles(files);
  });

  els.fileFilter.appendChild(filterBox("Filter by name", setFilter));
}

// Everything but the clipboard (which survives across connections, keyed
// by connection id) starts fresh for each push.
function resetState(conn: StorageConnection): void {
  state.conn = conn;
  state.client = null;
  state.bucket = conn.bucket || null;
  state.prefix = conn.prefix || "";
  state.token = null;
  state.stats = { folders: 0, files: 0, bytes: 0 };
  state.listedItems = [];
  state.filter = "";
  state.selectMode = false;
  state.selected = new Map();
}

function updateToolbar(): void {
  const inBucket = !!state.bucket && !!state.client;
  els.newFolderBtn.disabled = !inBucket;
  els.uploadBtn.disabled = !inBucket;
  els.selectModeBtn.disabled = !inBucket;
  updateClipboardUI();
}

export function bucketScreen(conn: StorageConnection, opts?: { title?: string; subtitle?: string }): Screen {
  return {
    title: opts?.title ?? conn.name ?? conn.bucket,
    subtitle: opts?.subtitle ?? (conn.name && conn.name !== conn.bucket ? conn.bucket : undefined),
    async render(body, header) {
      const template = document.getElementById("storageTemplate") as HTMLTemplateElement;
      body.classList.add("bucket-screen");
      body.appendChild(template.content.cloneNode(true));
      initScreenEls();
      fillScreenIcons();
      wireScreen();

      if (isStored(conn)) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "icon-btn";
        edit.title = "Edit connection";
        edit.setAttribute("aria-label", "Edit connection");
        edit.innerHTML = icon("settings");
        edit.addEventListener("click", () => openConnectionModal(conn));
        header.actions.appendChild(edit);
      }

      resetState(conn);
      try {
        state.client = createClient(conn);
      } catch (err) {
        // e.g. a GCS connection whose stored credentials JSON no longer parses
        console.error(err);
        setStatus(errorMessage(err), { error: true });
      }
      updateToolbar();
      renderBreadcrumb();
      await refresh();
    },
    onLeave() {
      if (els.detailModal.open) els.detailModal.close();
      if (els.shareModal.open) els.shareModal.close();
      state.client = null;
      state.conn = null;
    },
  };
}
