// Element lookups and small DOM helpers shared by the bucket browser's
// modules. `els` holds two groups: the static dialogs in sidepanel.html
// (looked up once at boot by initDialogEls()) and the bucket screen's own
// controls, cloned from <template id="storageTemplate"> on every push and
// re-looked-up by initScreenEls() (see bucket-screen.ts). Modules can import
// `els` up front either way.
import { icon } from "../lib/icons.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in sidepanel.html`);
  return el as T;
};

const btn = (id: string) => $<HTMLButtonElement>(id);
const input = (id: string) => $<HTMLInputElement>(id);
const dialog = (id: string) => $<HTMLDialogElement>(id);

function lookupScreen() {
  return {
    breadcrumb: $("breadcrumb"),
    refreshBtn: btn("refreshBtn"),
    selectModeBtn: btn("selectModeBtn"),
    pasteBtn: btn("pasteBtn"),
    clipboardPill: $("clipboardPill"),
    clipboardIcon: $("clipboardIcon"),
    clipboardCount: $("clipboardCount"),
    clipboardClearBtn: btn("clipboardClearBtn"),
    selectionBar: $("selectionBar"),
    selectAllCheckbox: input("selectAllCheckbox"),
    selectionCount: $("selectionCount"),
    bulkCopyBtn: btn("bulkCopyBtn"),
    bulkMoveBtn: btn("bulkMoveBtn"),
    bulkDeleteBtn: btn("bulkDeleteBtn"),
    exitSelectBtn: btn("exitSelectBtn"),
    newFolderBtn: btn("newFolderBtn"),
    uploadBtn: btn("uploadBtn"),
    uploadInput: input("uploadInput"),
    status: $("status"),
    fileFilter: $("fileFilter"),
    fileList: $("fileList"),
    loadMoreBtn: btn("loadMoreBtn"),
    listStats: $("listStats"),
  };
}

function lookupDialogs() {
  return {
    connectionModal: dialog("connectionModal"),
    connectionForm: $<HTMLFormElement>("connectionForm"),
    connectionModalTitle: $("connectionModalTitle"),
    connId: input("connId"),
    connType: input("connType"),
    connTypeHint: $("connTypeHint"),
    connAccessKeyField: $("connAccessKeyField"),
    connAccessKeyLabel: $("connAccessKeyLabel"),
    connAccessKey: input("connAccessKey"),
    connSecretKeyField: $("connSecretKeyField"),
    connSecretKeyLabel: $("connSecretKeyLabel"),
    connSecretKey: input("connSecretKey"),
    connServiceAccountJsonField: $("connServiceAccountJsonField"),
    connServiceAccountJson: $<HTMLTextAreaElement>("connServiceAccountJson"),
    connCredentialsFileBtn: btn("connCredentialsFileBtn"),
    connCredentialsFile: input("connCredentialsFile"),
    connResources: $("connResources"),
    connName: input("connName"),
    connAdvanced: $<HTMLDetailsElement>("connAdvanced"),
    connRegionField: $("connRegionField"),
    connRegion: input("connRegion"),
    connEndpointField: $("connEndpointField"),
    connEndpoint: input("connEndpoint"),
    connDeleteBtn: btn("connDeleteBtn"),
    connCancelBtn: btn("connCancelBtn"),
    connSaveBtn: btn("connSaveBtn"),
    connFormStatus: $("connFormStatus"),
    toggleSecretBtn: btn("toggleSecretBtn"),
    confirmDialog: dialog("confirmDialog"),
    confirmIcon: $("confirmIcon"),
    confirmTitle: $("confirmTitle"),
    confirmMessage: $("confirmMessage"),
    confirmOkBtn: btn("confirmOkBtn"),
    confirmCancelBtn: btn("confirmCancelBtn"),
    promptDialog: dialog("promptDialog"),
    promptForm: $<HTMLFormElement>("promptForm"),
    promptTitle: $("promptTitle"),
    promptLabel: $("promptLabel"),
    promptInput: input("promptInput"),
    promptCancelBtn: btn("promptCancelBtn"),
    shareModal: dialog("shareModal"),
    shareModalTitle: $("shareModalTitle"),
    shareUriLabel: $("shareUriLabel"),
    shareS3Uri: input("shareS3Uri"),
    copyS3UriBtn: btn("copyS3UriBtn"),
    shareHttpUrl: input("shareHttpUrl"),
    copyHttpUrlBtn: btn("copyHttpUrlBtn"),
    shareSignedRow: $("shareSignedRow"),
    shareExpiry: $<HTMLSelectElement>("shareExpiry"),
    generateSignedBtn: btn("generateSignedBtn"),
    shareSignedUrl: input("shareSignedUrl"),
    copySignedUrlBtn: btn("copySignedUrlBtn"),
    shareCloseBtn: btn("shareCloseBtn"),
    detailModal: dialog("detailModal"),
    detailIcon: $("detailIcon"),
    detailName: $("detailName"),
    detailCloseBtn: btn("detailCloseBtn"),
    detailMeta: $("detailMeta"),
    detailPreview: $("detailPreview"),
    detailSaveBtn: btn("detailSaveBtn"),
    detailShareBtn: btn("detailShareBtn"),
    detailDownloadBtn: btn("detailDownloadBtn"),
    detailOpenBtn: btn("detailOpenBtn"),
    detailCopyBtn: btn("detailCopyBtn"),
    detailMoveBtn: btn("detailMoveBtn"),
    detailDeleteBtn: btn("detailDeleteBtn"),
  };
}

export type Els = ReturnType<typeof lookupScreen> & ReturnType<typeof lookupDialogs>;
export const els = {} as Els;

export function initDialogEls(): void {
  Object.assign(els, lookupDialogs());
}

// Call after each mount of the bucket screen's template (its elements are
// new every time).
export function initScreenEls(): void {
  Object.assign(els, lookupScreen());
}

export function escapeHtml(str: unknown): string {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export interface StatusOpts {
  error?: boolean;
  loading?: boolean;
}

function applyStatus(el: HTMLElement, message: string, { error = false, loading = false }: StatusOpts = {}): void {
  el.hidden = !message;
  el.classList.toggle("error", error);
  el.classList.toggle("loading", loading);
  const iconName = error ? "alertCircle" : loading ? "refresh" : "";
  el.innerHTML = message ? `${iconName ? icon(iconName) : ""}<span>${escapeHtml(message)}</span>` : "";
}

export function setStatus(message: string, opts?: StatusOpts): void {
  applyStatus(els.status, message, opts);
}

export function setFormStatus(message: string, opts?: StatusOpts): void {
  applyStatus(els.connFormStatus, message, opts);
}

export function errorMessage(err: unknown): string {
  return (err as Error)?.message || String(err);
}

// Shows a busy line while `promise` runs; surfaces (and rethrows) its error.
export async function withStatus<T>(promise: Promise<T>, busyMessage: string): Promise<T> {
  setStatus(busyMessage, { loading: true });
  try {
    const result = await promise;
    setStatus("");
    return result;
  } catch (err) {
    console.error(err);
    setStatus(errorMessage(err), { error: true });
    throw err;
  }
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
