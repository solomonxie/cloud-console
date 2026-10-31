// Bucket browsing: breadcrumb navigation, paginated listing, rows,
// multi-select, and the per-object actions (download, delete, new folder,
// upload).
import { formatSize } from "@cloud-console/core/storage/format";
import type { ListPage } from "@cloud-console/core/storage/types";
import { favoriteButton, loadFavorites, pinFavorites } from "../lib/favorites.ts";
import { icon, iconForFileName } from "../lib/icons.ts";
import { applyFilter } from "../ui/search.ts";
import { setClipboard } from "./clipboard.ts";
import { isStored, openConnectionModal } from "./connections.ts";
import { confirmDialog, promptDialog } from "./dialogs.ts";
import { els, escapeHtml, formatDate, plural, setStatus, withStatus, errorMessage } from "./dom.ts";
import { openObjectDetail } from "./preview.ts";
import { open, rootPrefix, state, type Item } from "./state.ts";

// --- Navigation --------------------------------------------------------------

interface Crumb {
  label: string;
  iconName?: string;
  action: () => void;
}

export function renderBreadcrumb(): void {
  els.breadcrumb.innerHTML = "";
  const conn = state.conn;
  const crumbs: Crumb[] = [];
  if (conn) {
    const root = rootPrefix();
    crumbs.push({ label: conn.name, iconName: "bucket", action: () => navigateToPrefix(root) });
    // The connection's own prefix is part of the fixed root: show each of its
    // segments too, but every one of them just returns to that same root.
    for (const part of root.split("/").filter(Boolean)) {
      crumbs.push({ label: part, action: () => navigateToPrefix(root) });
    }
    const parts = state.prefix.slice(root.length).split("/").filter(Boolean);
    let acc = root;
    for (const part of parts) {
      acc += part + "/";
      const target = acc;
      crumbs.push({ label: part, action: () => navigateToPrefix(target) });
    }
  } else {
    crumbs.push({ label: "—", iconName: "home", action: () => {} });
  }
  crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.innerHTML = icon("chevronRight");
      els.breadcrumb.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.innerHTML = `${crumb.iconName ? icon(crumb.iconName) : ""}<span>${escapeHtml(crumb.label)}</span>`;
    btn.addEventListener("click", crumb.action);
    els.breadcrumb.appendChild(btn);
  });
}

export function navigateToPrefix(prefix: string): void {
  const root = rootPrefix();
  state.prefix = prefix.startsWith(root) ? prefix : root;
  state.token = null;
  clearFilter();
  renderBreadcrumb();
  void refresh();
}

// --- Filter ------------------------------------------------------------------

// Narrows the loaded rows by name (client-side only — it doesn't list
// anything new). Cleared whenever the folder changes.
export function setFilter(query: string): void {
  state.filter = query;
  applyRowFilter();
  renderStats();
}

function clearFilter(): void {
  state.filter = "";
  const input = els.fileFilter.querySelector("input");
  if (input) input.value = "";
}

function filterableRows(): HTMLElement[] {
  return [...els.fileList.querySelectorAll<HTMLElement>(".row[data-search]")];
}

function applyRowFilter(): void {
  applyFilter(filterableRows(), state.filter);
}

// Prefix one level up from `prefix`, never rising above `root`.
function parentPrefix(prefix: string, root: string): string {
  if (prefix.length <= root.length) return root;
  const trimmed = prefix.slice(0, -1); // drop trailing slash
  const idx = trimmed.lastIndexOf("/");
  const parent = idx >= 0 ? trimmed.slice(0, idx + 1) : "";
  return parent.length >= root.length ? parent : root;
}

// --- Listing -----------------------------------------------------------------

export async function refresh(): Promise<void> {
  state.token = null;
  state.listedItems = [];
  state.selected.clear();
  updateSelectionBar();
  els.fileList.innerHTML = "";
  els.loadMoreBtn.hidden = true;
  els.listStats.hidden = true;
  if (!state.client) return; // createClient failed; its error is in the status line
  if (!state.bucket) {
    const conn = state.conn;
    renderEmptyState("bucket", "This connection has no bucket set", "Edit it and add a bucket name.", conn && isStored(conn) ? {
      label: "Edit connection",
      onClick: () => openConnectionModal(conn),
    } : undefined);
    return;
  }
  await loadMore(true);
}

export async function loadMore(reset = false): Promise<void> {
  if (!state.client || !state.bucket) return;
  const list = els.fileList; // a new element on every push of the screen
  const prefix = state.prefix;
  try {
    const [data, favs] = await withStatus(
      Promise.all([
        state.client.listObjects(state.bucket, state.prefix, state.token ?? undefined),
        reset ? loadFavorites(favScope()).catch(() => new Set<string>()) : Promise.resolve(fav.ids),
      ]),
      "Loading…"
    );
    // Stale: the screen was left (or reopened on another connection), or the
    // user moved to another folder while this page was loading.
    if (els.fileList !== list || state.prefix !== prefix) return;
    fav.ids = favs;
    renderObjectRows(data, reset);
    state.token = data.nextToken ?? null;
    els.loadMoreBtn.hidden = !state.token;
    renderStats();
  } catch {
    // withStatus already surfaced the error
  }
}

interface EmptyAction {
  label: string;
  onClick: () => void;
}

function emptyStateNode(iconName: string, primary: string, secondary: string, action?: EmptyAction): HTMLElement {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `${icon(iconName)}<div class="primary">${escapeHtml(primary)}</div><div>${escapeHtml(secondary)}</div>`;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    div.appendChild(btn);
  }
  return div;
}

function renderEmptyState(iconName: string, primary: string, secondary: string, action?: EmptyAction): void {
  els.fileList.innerHTML = "";
  els.fileList.appendChild(emptyStateNode(iconName, primary, secondary, action));
}

// Lets the user step back out of the current folder without relying on the
// breadcrumb; never rises above the connection's own prefix boundary.
function appendParentRow(): void {
  const root = rootPrefix();
  if (state.prefix.length <= root.length) return;
  els.fileList.appendChild(
    makeRow({
      badgeIcon: "cornerUpLeft",
      badgeClass: "folder",
      name: "..",
      onOpen: () => navigateToPrefix(parentPrefix(state.prefix, root)),
    })
  );
}

function renderStats(): void {
  const { folders, files, bytes } = state.stats;
  if (folders + files === 0) {
    els.listStats.hidden = true;
    return;
  }
  const parts = [plural(folders, "folder"), plural(files, "file")];
  if (bytes) parts.push(formatSize(bytes));
  if (state.filter) {
    const rows = filterableRows();
    parts.unshift(`${rows.filter((r) => !r.hidden).length} of ${rows.length} shown`);
  }
  if (state.token) parts.push("more not loaded");
  els.listStats.hidden = false;
  els.listStats.textContent = parts.join(" · ");
}

// --- Multi-select ------------------------------------------------------------

export function setSelectMode(on: boolean): void {
  state.selectMode = on;
  state.selected.clear();
  els.selectModeBtn.classList.toggle("active", on);
  els.selectionBar.hidden = !on;
  updateSelectionBar();
  void refresh();
}

function toggleSelected(item: Item, checked: boolean): void {
  if (checked) state.selected.set(item.key, item);
  else state.selected.delete(item.key);
  updateSelectionBar();
}

export function updateSelectionBar(): void {
  const n = state.selected.size;
  els.selectionCount.textContent = `${n} selected`;
  els.selectAllCheckbox.checked = n > 0 && n === state.listedItems.length;
  els.selectAllCheckbox.indeterminate = n > 0 && n < state.listedItems.length;
  els.bulkCopyBtn.disabled = n === 0;
  els.bulkMoveBtn.disabled = n === 0;
  els.bulkDeleteBtn.disabled = n === 0;
}

export function syncRowCheckboxes(): void {
  els.fileList.querySelectorAll<HTMLInputElement>(".row-check").forEach((cb) => {
    const checked = state.selected.has(cb.dataset.key ?? "");
    cb.checked = checked;
    cb.closest(".row")?.classList.toggle("selected", checked);
  });
}

export async function bulkDelete(): Promise<void> {
  const items = [...state.selected.values()];
  if (!items.length) return;
  const ok = await confirmDialog({
    title: `Delete ${plural(items.length, "item")}?`,
    message: "Folders are deleted recursively. This can't be undone.",
  });
  if (!ok) return;
  try {
    const { client, bucket } = open();
    setStatus(`Deleting ${items.length} item(s)…`, { loading: true });
    for (const item of items) {
      if (item.isFolder) await client.deletePrefix(bucket, item.key);
      else await client.deleteObject(bucket, item.key);
    }
    setStatus("");
    setSelectMode(false);
  } catch (err) {
    console.error(err);
    setStatus(errorMessage(err), { error: true });
  }
}

// --- Favorites ---------------------------------------------------------------

// Starred folders/files of this bucket (any folder), and the loaded rows in
// their listing order, so favorites can be pinned within what's loaded.
const fav = { ids: new Set<string>(), rows: [] as HTMLElement[] };

function favScope(): string {
  return `bucket:${state.conn?.id ?? ""}:${state.bucket ?? ""}`;
}

function repinFavorites(): void {
  pinFavorites(els.fileList, fav.rows, fav.ids);
}

// --- Rows --------------------------------------------------------------------

interface RowAction {
  iconName: string;
  title: string;
  danger?: boolean;
  onClick: () => void;
}

interface RowSpec {
  badgeIcon: string;
  badgeClass?: string;
  name: string;
  meta?: string;
  onOpen?: () => void;
  actions?: RowAction[];
  itemKey?: string;
  isFolder?: boolean;
  checked?: boolean;
  favorite?: boolean; // gets a star (outside select mode) and can be pinned
}

function makeRow({ badgeIcon, badgeClass, name, meta, onOpen, actions, itemKey, isFolder, checked, favorite }: RowSpec): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  if (itemKey) row.dataset.search = name;
  if (favorite && itemKey) row.dataset.favId = itemKey;
  const selectable = state.selectMode && !!itemKey;

  if (selectable && itemKey) {
    row.classList.add("selectable");
    row.classList.toggle("selected", !!checked);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "row-check";
    cb.checked = !!checked;
    cb.dataset.key = itemKey;
    cb.setAttribute("aria-label", `Select ${name}`);
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      row.classList.toggle("selected", cb.checked);
      toggleSelected({ key: itemKey, isFolder: !!isFolder }, cb.checked);
    });
    row.appendChild(cb);
  }

  const badgeClickable = !selectable && onOpen;
  const badge = document.createElement(badgeClickable ? "button" : "span");
  badge.className = badgeClass ? `badge ${badgeClass}` : "badge";
  badge.innerHTML = icon(badgeIcon);
  if (badgeClickable) {
    (badge as HTMLButtonElement).type = "button";
    badge.title = name;
    badge.addEventListener("click", onOpen);
  }
  row.appendChild(badge);

  if (selectable) {
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    nameEl.title = name;
    row.appendChild(nameEl);
    row.addEventListener("click", (e) => {
      if ((e.target as Element).closest("input")) return;
      const cb = row.querySelector<HTMLInputElement>(".row-check");
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
  } else if (onOpen) {
    const btn = document.createElement("button");
    btn.className = "name-btn";
    btn.textContent = name;
    btn.title = name;
    btn.addEventListener("click", onOpen);
    row.appendChild(btn);
  } else {
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    nameEl.title = name;
    row.appendChild(nameEl);
  }

  const metaEl = document.createElement("span");
  metaEl.className = "meta";
  metaEl.textContent = meta || "";
  row.appendChild(metaEl);

  const actionsEl = document.createElement("span");
  actionsEl.className = "actions";
  if (favorite && itemKey && !state.selectMode) {
    actionsEl.appendChild(favoriteButton(favScope(), itemKey, fav.ids, repinFavorites));
  }
  for (const action of actions || []) {
    const btn = document.createElement("button");
    btn.className = action.danger ? "icon-btn danger-hover" : "icon-btn";
    btn.innerHTML = icon(action.iconName);
    btn.title = action.title;
    btn.setAttribute("aria-label", action.title);
    btn.addEventListener("click", action.onClick);
    actionsEl.appendChild(btn);
  }
  row.appendChild(actionsEl);

  return row;
}

function renderObjectRows(data: ListPage, reset: boolean): void {
  if (reset) {
    els.fileList.innerHTML = "";
    state.stats = { folders: 0, files: 0, bytes: 0 };
    fav.rows = [];
    appendParentRow();
  }
  state.stats.folders += data.folders.length;
  for (const prefix of data.folders) {
    const name = prefix.slice(state.prefix.length).replace(/\/$/, "");
    const item = { key: prefix, isFolder: true };
    state.listedItems.push(item);
    const row = makeRow({
      badgeIcon: "folder",
      badgeClass: "folder",
      name,
      itemKey: prefix,
      isFolder: true,
      checked: state.selected.has(prefix),
      favorite: true,
      onOpen: () => navigateToPrefix(prefix),
      actions: state.selectMode
        ? []
        : [
            { iconName: "copy", title: "Copy", onClick: () => setClipboard([item], false) },
            { iconName: "scissors", title: "Cut", onClick: () => setClipboard([item], true) },
            { iconName: "trash", title: "Delete folder", danger: true, onClick: () => void deleteFolder(prefix) },
          ],
    });
    fav.rows.push(row);
    els.fileList.appendChild(row);
  }
  for (const obj of data.objects) {
    if (obj.key.endsWith("/")) continue; // folder-marker object, already shown as a folder
    const name = obj.key.slice(state.prefix.length);
    if (!name) continue;
    state.stats.files += 1;
    state.stats.bytes += obj.size || 0;
    const item = { key: obj.key, isFolder: false };
    state.listedItems.push(item);
    const row = makeRow({
      badgeIcon: iconForFileName(name),
      name,
      meta: `${formatSize(obj.size)} · ${formatDate(obj.lastModified)}`,
      itemKey: obj.key,
      isFolder: false,
      checked: state.selected.has(obj.key),
      favorite: true,
      onOpen: () => openObjectDetail(obj, name),
      actions: state.selectMode
        ? []
        : [
            { iconName: "copy", title: "Copy", onClick: () => setClipboard([item], false) },
            { iconName: "scissors", title: "Cut", onClick: () => setClipboard([item], true) },
          ],
    });
    fav.rows.push(row);
    els.fileList.appendChild(row);
  }
  if (reset && data.folders.length === 0 && data.objects.length === 0) {
    els.fileList.appendChild(emptyStateNode("inbox", "This folder is empty", "Upload a file or drop one here."));
  }
  // Favorites first (after ".."), within what's loaded so far; folders still
  // before files inside each group.
  repinFavorites();
  if (state.filter) applyRowFilter();
}

// --- Object actions ----------------------------------------------------------

export async function downloadObject(key: string, name: string): Promise<void> {
  try {
    const { client, bucket } = open();
    const blob = await withStatus(client.getObjectBlob(bucket, key), `Downloading ${name}…`);
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: name });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    // withStatus already surfaced the error
  }
}

export async function deleteObject(key: string): Promise<void> {
  const ok = await confirmDialog({ title: "Delete file?", message: key });
  if (!ok) return;
  try {
    const { client, bucket } = open();
    await withStatus(client.deleteObject(bucket, key), "Deleting…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function deleteFolder(prefix: string): Promise<void> {
  const ok = await confirmDialog({
    title: "Delete folder?",
    message: `Everything under ${prefix} will be permanently deleted.`,
  });
  if (!ok) return;
  try {
    const { client, bucket } = open();
    await withStatus(
      client.deletePrefix(bucket, prefix, (n) => setStatus(`Deleted ${n}…`, { loading: true })),
      "Deleting folder…"
    );
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

export async function createFolder(): Promise<void> {
  const name = await promptDialog({ title: "New folder", label: "Folder name" });
  if (!name) return;
  const key = state.prefix + name.replace(/\/+$/, "") + "/";
  try {
    const { client, bucket } = open();
    await withStatus(client.createFolder(bucket, key), "Creating folder…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

export async function uploadFiles(files: Iterable<File>): Promise<void> {
  const { client, bucket } = open();
  for (const file of files) {
    const key = state.prefix + file.name;
    try {
      await withStatus(
        client.putObject(bucket, key, file, file.type || "application/octet-stream"),
        `Uploading ${file.name}…`
      );
    } catch {
      // withStatus already surfaced the error; keep going with remaining files
    }
  }
  await refresh();
}
