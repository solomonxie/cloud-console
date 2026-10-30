// "Storage" section: the bucket browser. Its markup lives in
// <template id="storageTemplate"> in sidepanel.html and is mounted into the
// section container on first open; then every module's listeners are wired.
import { icon } from "../lib/icons.ts";
import { registerSection } from "../shell/registry.ts";
import { bulkDelete, createFolder, loadMore, refresh, setSelectMode, syncRowCheckboxes, updateSelectionBar, uploadFiles } from "./browser.ts";
import { clearClipboard, pasteClipboard, setClipboard } from "./clipboard.ts";
import { loadConnections, wireConnections } from "./connections.ts";
import { closeOnBackdropClick } from "./dialogs.ts";
import { els, initEls, setStatus } from "./dom.ts";
import { closeDetailModal, isEditorDirty, saveEditor } from "./preview.ts";
import { wireShare } from "./share.ts";
import { state } from "./state.ts";

// Static icon-only controls: filled in once so sidepanel.html stays markup-only.
function fillIcons(): void {
  els.addConnBtn.innerHTML = icon("plus");
  els.manageBtn.innerHTML = icon("settings");
  els.exportBtn.innerHTML = icon("share");
  els.importBtn.innerHTML = icon("import");
  els.refreshBtn.innerHTML = icon("refresh");
  els.pasteBtn.innerHTML = icon("clipboard");
  els.clipboardIcon.innerHTML = icon("clipboard");
  els.clipboardClearBtn.innerHTML = icon("x");
  els.newFolderBtn.innerHTML = `${icon("folderPlus")}<span>New folder</span>`;
  els.uploadBtn.innerHTML = `${icon("upload")}<span>Upload</span>`;
  els.toggleSecretBtn.innerHTML = icon("eye");
  els.copyS3UriBtn.innerHTML = icon("copy");
  els.copyHttpUrlBtn.innerHTML = icon("copy");
  els.copySignedUrlBtn.innerHTML = icon("copy");
  els.detailCloseBtn.innerHTML = icon("x");
  els.detailSaveBtn.innerHTML = icon("save");
  els.detailShareBtn.innerHTML = icon("share");
  els.detailDownloadBtn.innerHTML = icon("download");
  els.detailCopyBtn.innerHTML = icon("copy");
  els.detailMoveBtn.innerHTML = icon("scissors");
  els.detailDeleteBtn.innerHTML = icon("trash");
  const labels: [HTMLButtonElement, string][] = [
    [els.detailShareBtn, "Share"],
    [els.detailDownloadBtn, "Download"],
    [els.detailCopyBtn, "Copy"],
    [els.detailMoveBtn, "Cut"],
    [els.detailSaveBtn, "Save changes"],
    [els.detailDeleteBtn, "Delete"],
  ];
  for (const [btn, label] of labels) {
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
  els.selectModeBtn.innerHTML = icon("checkSquare");
  els.bulkCopyBtn.innerHTML = icon("copy");
  els.bulkMoveBtn.innerHTML = icon("move");
  els.bulkDeleteBtn.innerHTML = icon("trash");
  els.exitSelectBtn.innerHTML = icon("x");
}

function wireBrowser(): void {
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

async function render(container: HTMLElement): Promise<void> {
  const template = document.getElementById("storageTemplate") as HTMLTemplateElement;
  container.classList.add("storage-section");
  container.appendChild(template.content.cloneNode(true));
  initEls();
  fillIcons();
  wireConnections();
  wireBrowser();
  wireShare();
  wireDetail();
  await loadConnections();
}

registerSection({ id: "storage", title: "Storage", icon: "bucket", render });
