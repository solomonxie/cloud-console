// Storage connections: the add/edit form (one vendor's key fields plus its
// Resources section), delete, and export/import of all of them. A
// connection is vendor-level — a key, no bucket: its buckets are listed from
// the account, unless the Resources section limits it to one bucket/prefix.
// Home (app/home.ts) lists them; saving or deleting one goes back there so
// it re-renders.
import { credentialsProblem } from "@cloud-console/core/gcp/auth";
import { buildConnectionString, parseConnectionString } from "@cloud-console/core/storage/azure";
import { listBuckets } from "@cloud-console/core/storage/buckets";
import { createClient } from "@cloud-console/core/storage/client";
import {
  bucketConnection,
  connectionLabel,
  exportConnections,
  normalizeEndpoint,
  parseImport,
  regionForEndpoint,
  STORAGE_TYPE_VENDOR,
  type StorageConnection,
} from "@cloud-console/core/storage/connection";
import { detectBucketRegion } from "@cloud-console/core/storage/s3";
import type { StorageType } from "@cloud-console/core/storage/types";
import { validateKey as validateTencentKey } from "@cloud-console/core/tencent/sts";
import { icon } from "../lib/icons.ts";
import { saveBlob } from "../lib/save-file.ts";
import { nav } from "../app/nav.ts";
import { resourcesField, type ResourcesField } from "../app/resources-field.ts";
import { STORAGE_KIND, storageKinds, VENDOR_NAME } from "../app/vendors.ts";
import { deleteConnection, getConnections, newConnectionId, upsertConnection } from "../lib/store.ts";
import { confirmDialog } from "./dialogs.ts";
import { els, errorMessage, setFormStatus } from "./dom.ts";

// Synthetic connections built on the fly for a bucket under a Google Cloud
// account ("gcp:<accountId>:<bucket>") aren't in storage, so they can't be
// edited or deleted from the connection form.
export function isStored(conn: StorageConnection): boolean {
  return !conn.id.startsWith("gcp:");
}

// --- Connection form ---------------------------------------------------------

interface TypeMeta {
  // Label/placeholder of the Resources section's optional "Limit to" bucket.
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
// shape matches (accessKeyId/secretAccessKey); Azure's single
// connection string and GCS's credentials JSON get parsed down to those same
// fields (or, for GCS, a dedicated serviceAccountJson field) in
// saveConnectionFromForm — only the form labels and which fields apply
// change per type here. See docs/design.md.
const TYPE_META: Record<StorageType, TypeMeta> = {
  s3: {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "all buckets",
    showAccessKey: true,
    keyLabel: "Access key ID",
    showSecretKey: true,
    secretLabel: "Secret access key",
    showServiceAccountJson: false,
    hint: "An IAM access key. Each bucket's region is detected automatically.",
    showRegion: true,
    showEndpoint: false,
  },
  "s3-compat": {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "all buckets",
    showAccessKey: true,
    keyLabel: "Access key ID",
    showSecretKey: true,
    secretLabel: "Secret access key",
    showServiceAccountJson: false,
    hint: "Any S3-compatible service — Cloudflare R2, MinIO, etc. Endpoint is the account's host, without a bucket.",
    showRegion: false,
    showEndpoint: true,
  },
  // Only legacy imported/saved GCS connections land here — new Google Cloud
  // connections use the account dialog (gcp/screens.ts), which lists
  // buckets per project. A bare GCS key can't list buckets without a
  // project, so this one needs its bucket.
  gcs: {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "my-bucket (required)",
    showAccessKey: false,
    showSecretKey: false,
    showServiceAccountJson: true,
    hint: "Paste or load a service account JSON key (IAM & Admin → Service Accounts → Keys → Add key → JSON), or your gcloud application default credentials (~/.config/gcloud/application_default_credentials.json, from `gcloud auth application-default login`). Signed share links need a service account key.",
    showRegion: false,
    showEndpoint: false,
  },
  azure: {
    bucketLabel: "Container name",
    bucketPlaceholder: "all containers",
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
    bucketPlaceholder: "all buckets (e.g. my-bucket-1250000000)",
    showAccessKey: true,
    keyLabel: "SecretId",
    showSecretKey: true,
    secretLabel: "SecretKey",
    showServiceAccountJson: false,
    hint: "A CAM key (SecretId and SecretKey). COS buckets and CVM instances in every region are listed; the region is only needed for a bucket you limit to (looked up when left blank). Bucket names include the APPID suffix shown in the console.",
    showRegion: true,
    regionPlaceholder: "only for a limited-to bucket, e.g. ap-guangzhou",
    regionListId: "tencentCosRegions",
    showEndpoint: false,
  },
  "alibaba-oss": {
    bucketLabel: "Bucket name",
    bucketPlaceholder: "all buckets",
    showAccessKey: true,
    keyLabel: "AccessKey ID",
    showSecretKey: true,
    secretLabel: "AccessKey secret",
    showServiceAccountJson: false,
    hint: "Alibaba Cloud OSS, via its S3-compatible endpoint. Buckets in every region are listed through this region's endpoint.",
    showRegion: true,
    regionRequired: true,
    regionPlaceholder: "e.g. cn-hangzhou",
    regionListId: "alibabaOssRegions",
    showEndpoint: false,
  },
};

// The Resources section of the open form (rebuilt per open).
let resources: ResourcesField | null = null;

function applyTypeToForm(type: string): void {
  const meta = TYPE_META[type as StorageType] || TYPE_META.s3;

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
  els.connRegion.placeholder = meta.regionPlaceholder || "auto-detected per bucket";
  if (meta.regionListId) els.connRegion.setAttribute("list", meta.regionListId);
  else els.connRegion.removeAttribute("list");
  // Region isn't optional for these two — don't bury it in a collapsed
  // "Advanced" section the way S3's auto-detected one is.
  els.connAdvanced.open = !!meta.regionRequired;
}

// Opens the form for a new connection of `type` (picked in Home's "+"
// chooser), or to edit `conn`. The bucket screen passes its per-bucket
// synthetic connection; the form edits the stored one with that id.
export async function openConnectionModal(conn: StorageConnection | null, type: StorageType = "s3"): Promise<void> {
  if (conn) conn = (await getConnections()).find((c) => c.id === conn?.id) ?? conn;
  const connType = conn?.type || type;
  const vendorName = VENDOR_NAME[STORAGE_TYPE_VENDOR[connType]];
  els.connectionModalTitle.textContent = conn ? `Edit ${vendorName} connection` : `Add ${vendorName}`;
  els.connId.value = conn?.id || "";
  els.connType.value = connType;
  applyTypeToForm(connType);
  const meta = TYPE_META[connType];
  resources = resourcesField({
    kinds: storageKinds(connType),
    selected: conn?.resources,
    scopeKind: STORAGE_KIND[connType],
    scope: conn?.storageScope ?? (conn?.bucket ? { bucket: conn.bucket, prefix: conn.prefix } : undefined),
    bucketLabel: meta.bucketLabel,
    bucketPlaceholder: meta.bucketPlaceholder,
  });
  els.connResources.replaceChildren(resources.el);
  els.connAccessKey.value = conn?.accessKeyId || "";
  els.connSecretKey.value =
    conn?.type === "azure" && conn.accessKeyId
      ? buildConnectionString(conn.accessKeyId, conn.secretAccessKey ?? "")
      : conn?.secretAccessKey || "";
  els.connSecretKey.type = "password";
  els.toggleSecretBtn.innerHTML = icon("eye");
  els.connServiceAccountJson.value = conn?.serviceAccountJson || "";
  els.connName.value = conn?.name || "";
  els.connRegion.value = conn?.region || "";
  els.connEndpoint.value = conn?.endpoint || "";
  els.connDeleteBtn.hidden = !conn;
  setFormStatus("");
  els.connectionModal.showModal();
}

async function saveConnectionFromForm(): Promise<boolean> {
  const type = els.connType.value as StorageType;
  const picked = resources?.value() ?? { ok: true as const };
  if (!picked.ok) {
    setFormStatus(picked.error, { error: true });
    return false;
  }
  const scope = picked.storageScope;
  const bucket = scope?.bucket ?? "";
  if (type === "gcs" && !bucket) {
    setFormStatus("A Cloud Storage key needs a bucket here — add a Google Cloud account to list buckets per project.", { error: true });
    return false;
  }
  const conn: StorageConnection = {
    id: els.connId.value || newConnectionId(),
    type,
    name: els.connName.value.trim(),
    ...(picked.resources ? { resources: picked.resources } : {}),
    ...(scope ? { storageScope: scope } : {}),
  };
  conn.name = connectionLabel(conn);

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
    } else if (type === "tencent-cos") {
      // Buckets and CVM are listed account-wide, so the region only names
      // a limited-to bucket's host; left blank, it's looked up from the
      // bucket list (each COS bucket reports its own region).
      conn.accessKeyId = els.connAccessKey.value.trim();
      conn.secretAccessKey = els.connSecretKey.value.trim();
      let region = els.connRegion.value.trim();
      if (!region && bucket) {
        setFormStatus("Looking up the bucket's region…", { loading: true });
        region = (await listBuckets(conn).catch(() => [])).find((b) => b.name === bucket)?.region ?? "";
        if (!region) {
          setFormStatus("Couldn't find that bucket's region — enter it under Advanced.", { error: true });
          return false;
        }
      }
      if (region) conn.region = region;
    } else if (type === "alibaba-oss") {
      // Same S3 dialect as "s3"/"s3-compat" (S3Client picks the right host
      // for the type), but OSS doesn't expose AWS's region-sniffing
      // global endpoint, so the region has to be typed, not detected. Bucket
      // listing still covers every region (each bucket reports its own).
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
      // Unscoped, each listed bucket carries its own region (see
      // listBuckets); a limited-to bucket needs one stored here.
      let region = els.connRegion.value.trim();
      if (!region && bucket) {
        setFormStatus("Detecting region…", { loading: true });
        region = (await detectBucketRegion(bucket)) || "";
      }
      conn.region = region || "us-east-1";
    }

    // Validate with the key itself: list that one bucket under its prefix
    // (also works for keys without ListBuckets), or list the buckets.
    if (bucket) {
      setFormStatus("Checking bucket access…", { loading: true });
      try {
        await createClient(bucketConnection(conn, bucket)).listObjects(bucket, scope?.prefix ?? "", undefined);
      } catch (err) {
        setFormStatus(`Couldn't access that bucket: ${errorMessage(err)}`, { error: true });
        return false;
      }
    } else if (type === "tencent-cos" && picked.resources && !picked.resources.includes("cos")) {
      // No COS row: the key may have no COS permission at all — just check
      // the key itself (GetCallerIdentity needs no resource permission).
      setFormStatus("Checking the key…", { loading: true });
      try {
        await validateTencentKey({ secretId: conn.accessKeyId ?? "", secretKey: conn.secretAccessKey ?? "" });
      } catch (err) {
        setFormStatus(`Couldn't verify this key: ${errorMessage(err)}`, { error: true });
        return false;
      }
    } else {
      setFormStatus("Listing buckets…", { loading: true });
      try {
        await listBuckets(conn);
      } catch (err) {
        setFormStatus(`Couldn't list buckets with this key: ${errorMessage(err)} — if it can only reach one bucket, enter it under Limit to.`, { error: true });
        return false;
      }
    }

    await upsertConnection(conn);
    setFormStatus("");
    return true;
  } finally {
    els.connSaveBtn.disabled = false;
  }
}

async function deleteConnectionById(id: string): Promise<void> {
  const conn = (await getConnections()).find((c) => c.id === id);
  const ok = await confirmDialog({
    title: "Delete connection?",
    message: `"${conn?.name}" and its stored keys will be removed from this browser.`,
  });
  if (!ok) return;
  await deleteConnection(id);
  nav.home();
}

// --- Export / import ---------------------------------------------------------

export async function exportAllConnections(): Promise<void> {
  downloadTextFile("chrome-cloud-console-connections.json", exportConnections(await getConnections()));
}

// Merges connections from an exported JSON file; returns how many it read.
// Throws a user-facing message if the file isn't an export.
export async function importConnectionsFile(file: File): Promise<number> {
  const imported = parseImport(await file.text());
  for (const conn of imported) {
    await upsertConnection(conn);
  }
  return imported.length;
}

function downloadTextFile(filename: string, text: string): void {
  saveBlob(new Blob([text], { type: "application/json" }), filename);
}

// --- Wiring ------------------------------------------------------------------

// The connection modal is static markup: wire it once, at boot.
export function wireConnections(): void {
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
    if (!ok) return;
    els.connectionModal.close();
    // Back to Home (popping the bucket screen too, if it had this one open)
    // so the new/edited card shows.
    nav.home();
  });
}
