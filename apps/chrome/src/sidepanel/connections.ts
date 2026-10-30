// Connection picker, add/edit form (per-type fields), manage list, and
// export/import of all connections.
import { credentialsProblem } from "@cloud-console/core/gcp/auth";
import { buildConnectionString, parseConnectionString } from "@cloud-console/core/storage/azure";
import { createClient } from "@cloud-console/core/storage/client";
import {
  connectionLabel,
  exportConnections,
  normalizeEndpoint,
  normalizePrefix,
  parseImport,
  regionForEndpoint,
  type StorageConnection,
} from "@cloud-console/core/storage/connection";
import { detectBucketRegion } from "@cloud-console/core/storage/s3";
import type { StorageType } from "@cloud-console/core/storage/types";
import { icon } from "../lib/icons.ts";
import { deleteConnection, getConnections, newConnectionId, upsertConnection } from "../lib/store.ts";
import { refresh, renderBreadcrumb } from "./browser.ts";
import { updateClipboardUI } from "./clipboard.ts";
import { confirmDialog } from "./dialogs.ts";
import { els, errorMessage, escapeHtml, setFormStatus, setStatus } from "./dom.ts";
import { activeConnection, state } from "./state.ts";

export async function loadConnections(): Promise<void> {
  state.connections = await getConnections();
  const { lastConnectionId } = (await chrome.storage.local.get("lastConnectionId")) as { lastConnectionId?: string };
  state.activeId =
    (lastConnectionId && state.connections.some((c) => c.id === lastConnectionId)
      ? lastConnectionId
      : state.connections[0]?.id) || null;
  renderConnectionSelect();
  await onConnectionChanged();
}

function renderConnectionSelect(): void {
  els.connectionSelect.innerHTML = "";
  if (state.connections.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No connections — click +";
    els.connectionSelect.appendChild(opt);
    els.connectionSelect.disabled = true;
    return;
  }
  els.connectionSelect.disabled = false;
  for (const conn of state.connections) {
    const opt = document.createElement("option");
    opt.value = conn.id;
    opt.textContent = connectionLabel(conn);
    opt.selected = conn.id === state.activeId;
    els.connectionSelect.appendChild(opt);
  }
}

async function onConnectionChanged(): Promise<void> {
  const conn = activeConnection();
  state.client = null;
  if (conn) {
    try {
      state.client = createClient(conn);
    } catch (err) {
      // e.g. a GCS connection whose stored credentials JSON no longer parses
      console.error(err);
      setStatus(errorMessage(err), { error: true });
    }
  }
  state.bucket = conn?.bucket || null;
  state.prefix = conn?.prefix || "";
  state.token = null;
  await chrome.storage.local.set({ lastConnectionId: state.activeId });
  updateToolbar();
  renderBreadcrumb();
  await refresh();
}

function updateToolbar(): void {
  const inBucket = !!state.bucket;
  els.newFolderBtn.disabled = !inBucket;
  els.uploadBtn.disabled = !inBucket;
  els.selectModeBtn.disabled = !inBucket;
  els.manageBtn.disabled = !state.activeId;
  updateClipboardUI();
}

// --- Connection form ---------------------------------------------------------

interface TypeMeta {
  bucketLabel: string;
  bucketPlaceholder: string;
  showAccessKey: boolean;
  keyLabel?: string;
  showSecretKey: boolean;
  secretLabel?: string;
  showServiceAccountJson: boolean;
  hint: string;
  showRegion: boolean;
  regionRequired?: boolean;
  regionPlaceholder?: string;
  regionListId?: string;
  showEndpoint: boolean;
}

// Every type stores into the same underlying connection fields where the
// shape matches (bucket/accessKeyId/secretAccessKey); Azure's single
// connection string and GCS's credentials JSON get parsed down to those same
// fields (or, for GCS, a dedicated serviceAccountJson field) in
// saveConnectionFromForm — only the form labels and which fields apply
// change per type here. See docs/design.md.
const TYPE_META: Record<StorageType, TypeMeta> = {
  s3: {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "my-bucket",
    showAccessKey: true,
    keyLabel: "Access key ID",
    showSecretKey: true,
    secretLabel: "Secret access key",
    showServiceAccountJson: false,
    hint: "AWS S3. Region is auto-detected from the bucket.",
    showRegion: true,
    showEndpoint: false,
  },
  "s3-compat": {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "my-bucket",
    showAccessKey: true,
    keyLabel: "Access key ID",
    showSecretKey: true,
    secretLabel: "Secret access key",
    showServiceAccountJson: false,
    hint: "Any S3-compatible service — Cloudflare R2, MinIO, etc.",
    showRegion: false,
    showEndpoint: true,
  },
  gcs: {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "my-bucket",
    showAccessKey: false,
    showSecretKey: false,
    showServiceAccountJson: true,
    hint: "Paste or load a service account JSON key (IAM & Admin → Service Accounts → Keys → Add key → JSON), or your gcloud application default credentials (~/.config/gcloud/application_default_credentials.json, from `gcloud auth application-default login`). Signed share links need a service account key.",
    showRegion: false,
    showEndpoint: false,
  },
  azure: {
    bucketLabel: "Container name",
    bucketPlaceholder: "my-container",
    showAccessKey: false,
    showSecretKey: true,
    secretLabel: "Connection string",
    showServiceAccountJson: false,
    hint: "Uses the storage account's connection string (Access keys page → Connection string).",
    showRegion: false,
    showEndpoint: false,
  },
  "tencent-cos": {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "my-bucket-1250000000",
    showAccessKey: true,
    keyLabel: "SecretId",
    showSecretKey: true,
    secretLabel: "SecretKey",
    showServiceAccountJson: false,
    hint: "Tencent Cloud COS, via its S3-compatible endpoint. Bucket name includes the APPID suffix shown in the console. Region is required.",
    showRegion: true,
    regionRequired: true,
    regionPlaceholder: "e.g. ap-guangzhou",
    regionListId: "tencentCosRegions",
    showEndpoint: false,
  },
  "alibaba-oss": {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "my-bucket",
    showAccessKey: true,
    keyLabel: "AccessKey ID",
    showSecretKey: true,
    secretLabel: "AccessKey secret",
    showServiceAccountJson: false,
    hint: "Alibaba Cloud OSS, via its S3-compatible endpoint. Region is required.",
    showRegion: true,
    regionRequired: true,
    regionPlaceholder: "e.g. cn-hangzhou",
    regionListId: "alibabaOssRegions",
    showEndpoint: false,
  },
};

function applyTypeToForm(type: string): void {
  const meta = TYPE_META[type as StorageType] || TYPE_META.s3;
  els.connBucketLabel.textContent = meta.bucketLabel;
  els.connBucket.placeholder = meta.bucketPlaceholder;

  els.connAccessKeyField.hidden = !meta.showAccessKey;
  els.connAccessKey.required = meta.showAccessKey;
  if (meta.showAccessKey) els.connAccessKeyLabel.textContent = meta.keyLabel ?? "";

  els.connSecretKeyField.hidden = !meta.showSecretKey;
  els.connSecretKey.required = meta.showSecretKey;
  if (meta.showSecretKey) els.connSecretKeyLabel.textContent = meta.secretLabel ?? "";

  els.connServiceAccountJsonField.hidden = !meta.showServiceAccountJson;
  els.connServiceAccountJson.required = meta.showServiceAccountJson;
  els.connCredentialsFileBtn.hidden = !meta.showServiceAccountJson;

  els.connEndpointField.hidden = !meta.showEndpoint;
  els.connEndpoint.required = meta.showEndpoint;

  els.connTypeHint.textContent = meta.hint;
  els.connRegionField.hidden = !meta.showRegion;
  els.connAdvanced.hidden = !meta.showRegion;
  els.connRegion.required = !!meta.regionRequired;
  els.connRegion.placeholder = meta.regionPlaceholder || "auto-detected from bucket";
  if (meta.regionListId) els.connRegion.setAttribute("list", meta.regionListId);
  else els.connRegion.removeAttribute("list");
  // Region isn't optional for these two — don't bury it in a collapsed
  // "Advanced" section the way S3's auto-detected one is.
  els.connAdvanced.open = !!meta.regionRequired;
}

export function openConnectionModal(conn: StorageConnection | null): void {
  els.connectionModalTitle.textContent = conn ? "Edit connection" : "Add connection";
  els.connId.value = conn?.id || "";
  els.connType.value = conn?.type || "s3";
  applyTypeToForm(els.connType.value);
  els.connBucket.value = conn?.bucket || "";
  els.connAccessKey.value = conn?.accessKeyId || "";
  els.connSecretKey.value =
    conn?.type === "azure" && conn.accessKeyId
      ? buildConnectionString(conn.accessKeyId, conn.secretAccessKey ?? "")
      : conn?.secretAccessKey || "";
  els.connSecretKey.type = "password";
  els.toggleSecretBtn.innerHTML = icon("eye");
  els.connServiceAccountJson.value = conn?.serviceAccountJson || "";
  els.connPrefix.value = conn?.prefix || "";
  els.connName.value = conn?.name && conn.name !== conn.bucket ? conn.name : "";
  els.connRegion.value = conn?.region || "";
  els.connEndpoint.value = conn?.endpoint || "";
  els.connDeleteBtn.hidden = !conn;
  setFormStatus("");
  els.connectionModal.showModal();
}

async function saveConnectionFromForm(): Promise<boolean> {
  const type = els.connType.value as StorageType;
  const bucket = els.connBucket.value.trim();
  const conn: StorageConnection = {
    id: els.connId.value || newConnectionId(),
    type,
    bucket,
    name: els.connName.value.trim() || bucket,
    prefix: normalizePrefix(els.connPrefix.value.trim()),
  };

  els.connSaveBtn.disabled = true;
  try {
    if (type === "s3-compat") {
      conn.accessKeyId = els.connAccessKey.value.trim();
      conn.secretAccessKey = els.connSecretKey.value.trim();
      conn.endpoint = normalizeEndpoint(els.connEndpoint.value);
      // No path-style question: S3Client already forces it whenever an
      // endpoint is set. No region question either — see regionForEndpoint().
      conn.region = regionForEndpoint(conn.endpoint);
      const granted = await chrome.permissions.request({ origins: [`https://${conn.endpoint}/*`] });
      if (!granted) {
        setFormStatus("Permission for that endpoint was not granted.", { error: true });
        return false;
      }
    } else if (type === "gcs") {
      // Service account JSON key or gcloud's application default
      // credentials — GCP's non-interactive credentials, not HMAC interop
      // keys and not an OAuth sign-in flow.
      const raw = els.connServiceAccountJson.value.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        setFormStatus("That doesn't look like valid JSON.", { error: true });
        return false;
      }
      const problem = credentialsProblem(parsed);
      if (problem) {
        setFormStatus(problem, { error: true });
        return false;
      }
      conn.serviceAccountJson = raw;
    } else if (type === "azure") {
      // A single connection string, parsed into the account name/key
      // AzureClient signs with — see parseConnectionString().
      try {
        const { accountName, accountKey } = parseConnectionString(els.connSecretKey.value.trim());
        conn.accessKeyId = accountName;
        conn.secretAccessKey = accountKey;
      } catch (err) {
        setFormStatus(errorMessage(err), { error: true });
        return false;
      }
    } else if (type === "tencent-cos" || type === "alibaba-oss") {
      // Same S3 dialect as "s3"/"s3-compat" (S3Client picks the right host
      // for the type), but neither COS nor OSS exposes AWS's region-sniffing
      // global endpoint, so the region has to be typed, not detected.
      conn.accessKeyId = els.connAccessKey.value.trim();
      conn.secretAccessKey = els.connSecretKey.value.trim();
      const region = els.connRegion.value.trim();
      if (!region) {
        setFormStatus("Region is required for this provider.", { error: true });
        return false;
      }
      conn.region = region;
    } else {
      conn.accessKeyId = els.connAccessKey.value.trim();
      conn.secretAccessKey = els.connSecretKey.value.trim();
      let region = els.connRegion.value.trim();
      if (!region) {
        setFormStatus("Detecting region…", { loading: true });
        region = (await detectBucketRegion(bucket)) || "us-east-1";
      }
      conn.region = region;
    }

    setFormStatus("Checking bucket access…", { loading: true });
    try {
      await createClient(conn).listObjects(conn.bucket, conn.prefix ?? "", undefined);
    } catch (err) {
      setFormStatus(`Couldn't access that bucket: ${errorMessage(err)}`, { error: true });
      return false;
    }

    state.connections = await upsertConnection(conn);
    state.activeId = conn.id;
    renderConnectionSelect();
    await onConnectionChanged();
    setFormStatus("");
    return true;
  } finally {
    els.connSaveBtn.disabled = false;
  }
}

async function deleteConnectionById(id: string): Promise<void> {
  const conn = state.connections.find((c) => c.id === id);
  const ok = await confirmDialog({
    title: "Delete connection?",
    message: `"${conn?.name}" and its stored keys will be removed from this browser.`,
  });
  if (!ok) return;
  state.connections = await deleteConnection(id);
  if (state.activeId === id) state.activeId = state.connections[0]?.id || null;
  renderConnectionSelect();
  renderManageList();
  await onConnectionChanged();
}

// --- Manage modal ------------------------------------------------------------

function renderManageList(): void {
  els.manageList.innerHTML = "";
  for (const conn of state.connections) {
    const li = document.createElement("li");
    li.className = conn.id === state.activeId ? "active" : "";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.innerHTML = icon("bucket");
    li.appendChild(badge);

    const label = connectionLabel(conn);
    const name = document.createElement("span");
    name.className = "name";
    name.innerHTML =
      !conn.bucket || label === conn.bucket
        ? escapeHtml(label)
        : `${escapeHtml(label)}<small>${escapeHtml(conn.bucket)}</small>`;
    li.appendChild(name);

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.title = "Edit";
    editBtn.setAttribute("aria-label", `Edit ${conn.name}`);
    editBtn.innerHTML = icon("settings");
    editBtn.addEventListener("click", () => openConnectionModal(conn));
    li.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn danger-hover";
    deleteBtn.title = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${conn.name}`);
    deleteBtn.innerHTML = icon("trash");
    deleteBtn.addEventListener("click", () => void deleteConnectionById(conn.id));
    li.appendChild(deleteBtn);

    els.manageList.appendChild(li);
  }
  if (state.connections.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No connections yet.";
    els.manageList.appendChild(li);
  }
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  void chrome.downloads.download({ url, filename }).then(() => {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

// --- Wiring ------------------------------------------------------------------

export function wireConnections(): void {
  els.connectionSelect.addEventListener("change", async () => {
    state.activeId = els.connectionSelect.value;
    await onConnectionChanged();
  });
  els.addConnBtn.addEventListener("click", () => openConnectionModal(null));
  els.manageBtn.addEventListener("click", () => openConnectionModal(activeConnection()));
  els.connType.addEventListener("change", () => applyTypeToForm(els.connType.value));

  // An extension can't read ~/.config itself — the file picker is how the
  // user grants access to one file, once. Its contents land in the textarea
  // and are stored like a pasted key; the file isn't re-read later, so a
  // re-login (new refresh token) means loading it again.
  els.connCredentialsFileBtn.addEventListener("click", () => els.connCredentialsFile.click());
  els.connCredentialsFile.addEventListener("change", async () => {
    const file = els.connCredentialsFile.files?.[0];
    els.connCredentialsFile.value = "";
    if (file) els.connServiceAccountJson.value = (await file.text()).trim();
  });

  // Bucket names don't encode a region, but the field is still enough to look
  // one up (see detectBucketRegion) — do it as soon as the user leaves the
  // field so Advanced/Region is already filled in if they open it. Only AWS S3
  // has a region to detect.
  els.connBucket.addEventListener("blur", async () => {
    if (els.connType.value !== "s3") return;
    const bucket = els.connBucket.value.trim();
    if (!bucket || els.connRegion.value.trim()) return;
    els.connRegion.placeholder = "detecting…";
    els.connRegion.value = (await detectBucketRegion(bucket)) || "";
    els.connRegion.placeholder = "auto-detected from bucket";
  });

  els.connCancelBtn.addEventListener("click", () => els.connectionModal.close());
  els.connDeleteBtn.addEventListener("click", async () => {
    const id = els.connId.value;
    els.connectionModal.close();
    if (id) await deleteConnectionById(id);
  });
  els.toggleSecretBtn.addEventListener("click", () => {
    const show = els.connSecretKey.type === "password";
    els.connSecretKey.type = show ? "text" : "password";
    els.toggleSecretBtn.innerHTML = icon(show ? "eyeOff" : "eye");
  });
  els.connectionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = await saveConnectionFromForm();
    if (ok) els.connectionModal.close();
  });
  els.connManageAllBtn.addEventListener("click", () => {
    els.connectionModal.close();
    renderManageList();
    els.manageModal.showModal();
  });

  els.manageCloseBtn.addEventListener("click", () => els.manageModal.close());
  els.exportBtn.addEventListener("click", () => {
    downloadTextFile("chrome-cloud-console-connections.json", exportConnections(state.connections));
  });
  els.importBtn.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", async () => {
    const file = els.importInput.files?.[0];
    if (!file) return;
    try {
      const imported = parseImport(await file.text());
      for (const conn of imported) {
        await upsertConnection(conn);
      }
      state.connections = await getConnections();
      renderConnectionSelect();
      renderManageList();
      setStatus(`Imported ${imported.length} connection(s).`);
    } catch (err) {
      setStatus(errorMessage(err), { error: true });
    }
    els.importInput.value = "";
  });
}
