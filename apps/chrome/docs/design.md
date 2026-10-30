# Design

**Every surface is drawn in `uiux/`.** This file carries the problem,
the options and the architecture; the drawings carry the interface.

## Problem

Browsing cloud storage today means each provider's own console (slow,
account-wide login) or a CLI, a different one per provider. Want a
lightweight Chrome side panel: pick a saved connection, land straight in a
bucket like a file explorer, do basic file ops, without leaving the browser
tab — regardless of which provider the bucket lives on.

## Goals

- Chrome side panel, always one click away.
- Multiple named, bucket-scoped connections (type + bucket + key pair +
  starting prefix), switchable. Adding one only strictly requires a type,
  bucket/container name and key pair — region (where applicable) is
  auto-detected, name defaults to the bucket name.
- Six connection types: Amazon S3, S3-compatible (custom endpoint), Azure
  Blob Storage (connection string), Google Cloud Storage (service account
  JSON key), Tencent Cloud COS and Alibaba Cloud OSS (both via their own
  S3-compatible endpoints, key pair + region) — no interactive OAuth/browser
  sign-in for any of them.
- Keys stored locally only; exportable/importable as JSON.
- Browse folders → files under that bucket (prefix/delimiter navigation).
- File ops: download, copy, cut/move, paste, delete, multi-select bulk
  versions of each. Folder ops: create, recursive copy, recursive delete.
- Preview common file types inline (image/video/audio/PDF/text/Markdown);
  edit text/Markdown in place and save back.
- Share a file via a provider URI (s3://, az://), unsigned HTTP link, or a
  signed link.

## Non-goals (v0)

- Bucket creation/policy/ACL management.
- Multi-part upload for very large files.
- Sync/watch, in-browser video/audio transcoding.
- Cross-connection copy/move (clipboard paste is scoped to the connection
  items were copied from — cross-bucket copy would need credentials valid
  for both buckets).

## Options considered

**Cloud SDK bundles vs. hand-rolled REST calls.** SDKs ship hundreds of KB
each, worse with four providers, and most don't run on React Native.
Chosen: hand-rolled request signing over `fetch` — SigV4 for
S3/S3-compatible/COS/OSS, Shared Key for Azure, OAuth tokens for GCS — in
the shared `packages/core` TypeScript package, so the mobile app signs the
same way. HMAC/SHA-256 come from `@noble/hashes` and XML parsing from
`fast-xml-parser` (React Native's Hermes has neither `crypto.subtle` nor
`DOMParser`). The extension is TypeScript bundled by esbuild into `dist/`
(no cloud SDKs, no remote code). Trade-off: only the REST operations we
implement are supported, and only the auth schemes that don't need OAuth
(see below).

**No interactive OAuth.** Azure AD's and Google's interactive sign-in are
both a browser consent flow — wrong fit for a side panel with no server to
hold a refresh token. Skipped in favor of each provider's non-interactive
credential: Azure's storage-account connection string (Shared Key auth) and
a GCS service-account JSON key (JWT Bearer Token flow — see below) or the
gcloud application default credentials file — the credentials each provider
hands out for non-interactive use, and what their own SDKs accept. Trade-off: the user generates that credential themselves
once, outside the extension (Azure portal → Access keys; GCP console →
IAM & Admin → Service Accounts → Keys).

**GCS: service-account JWT, not HMAC interop keys.** GCS's XML API also
accepts HMAC keys signed AWS-SigV4-style, which would have let GCS reuse
`S3Client` outright. Not chosen — a service-account JSON key is the
credential GCP's own docs steer new projects toward, and it's what GCP's
client libraries take. The extension performs the same non-interactive
server-to-server OAuth2 flow those libraries do under the hood: sign a JWT
with the service account's RSA private key, exchange it for a short-lived
access token
(`packages/core/src/gcp/auth.ts`) — no browser, no user consent screen, just the JSON key.

**GCS: gcloud application default credentials too.** The file
`gcloud auth application-default login` writes
(`~/.config/gcloud/application_default_credentials.json`, type
`authorized_user`) holds an OAuth client id/secret and a refresh token;
exchanging the refresh token at Google's token endpoint gives the same kind
of access token. The consent screen already happened in gcloud, so the
extension still runs no OAuth flow itself. An extension can't read `~/.config`
on its own, so the form's "Load from file…" picker is the permission: the
user picks the file once, its contents are stored like a pasted key, and a
later `gcloud` re-login means loading it again. Trade-off: no private key,
so no V4 signed URLs — previews of media fetch the object into a blob URL
instead, and the Share dialog hides the signed link.

**Where credentials live.** `chrome.storage.local` (not `sync`) so keys never
leave the machine via Chrome sync. Export/import is an explicit user action,
plaintext JSON — acceptable for a personal tool, called out in the UI.

**Side panel vs. popup.** Popups close on focus loss, killing in-progress
transfers and forcing re-navigation. `chrome.sidePanel` persists alongside
the tab.

## Architecture

```
packages/core/src/            shared with the mobile app, consumed from source
  aws/sigv4.ts                AWS SigV4 request signing + presigning
  gcp/auth.ts                 Google service-account JWT / refresh-token auth + GOOG4 signed URLs
  storage/types.ts            StorageClient interface every client implements
  storage/connection.ts       StorageConnection (the stored shape) + export/import, normalizers
  storage/client.ts           createClient(): picks S3Client/AzureClient/GcsClient by type
                              (S3Client also covers S3-compatible, Tencent COS, Alibaba OSS)
  storage/s3.ts               S3-dialect REST ops, XML parsing, detectBucketRegion()
  storage/azure-sig.ts        Azure Shared Key signing + Service SAS presigning
  storage/azure.ts            Azure Blob REST ops, XML parsing, connection-string parsing
  storage/gcs.ts              GCS JSON Storage API ops
  storage/format.ts, preview.ts   byte sizes; file name -> preview kind + content-type

apps/chrome/
  static/                     copied as-is into dist/: manifest, sidepanel.html/.css, icons
  src/background.ts           opens the side panel on the toolbar icon click
  src/shell/                  section registry + switcher (Storage, Google Cloud, …)
  src/sidepanel/main.ts       entry: imports each section, starts the shell
  src/sidepanel/*.ts          the Storage section (vanilla DOM, no framework):
                              connections, browser, clipboard, preview, share, dialogs
  src/gcp/                    the Google Cloud section (projects, VMs, groups, secrets)
  src/lib/                    store (chrome.storage.local), icons, markdown
  build.mjs                   esbuild bundle -> dist/
```

**Sections.** The panel is a small shell hosting top-level sections. A
feature module calls `registerSection({ id, title, icon, render })` on
import; the shell shows a segmented switcher once more than one section is
registered, renders each section into its own container the first time
it's opened, and only hides it on switch so its state survives. A section
that isn't built isn't registered, so it never shows up.

No background/content-script relay for API calls — the side panel is a full
document with `host_permissions`, so it calls the provider directly via
`fetch`. `S3Client`, `AzureClient` and `GcsClient` implement the same
`StorageClient` interface (`listObjects`, `getObjectBlob`, `copyObject`,
`presignedUrl`, …) so the UI never branches on connection type —
`createClient()` is the only place that does.

## Data model

A connection is bucket-scoped — one connection browses one bucket/container
(starting at an optional prefix), not a whole account's bucket list. Simpler
mental model, and it's what the required fields (bucket, credential, prefix)
are for. S3/S3-compatible/Azure store into a common `accessKeyId`/
`secretAccessKey` shape (parsed down to that from a single connection string
for Azure — see below); GCS's service account JSON doesn't fit that shape,
so it gets its own field (holding either credentials type).

```js
// one entry in chrome.storage.local["connections"] (StorageConnection)
{
  id,
  type,              // "s3" | "s3-compat" | "azure" | "gcs" | "tencent-cos" | "alibaba-oss"
  bucket,            // required (container name, for azure)
  accessKeyId, secretAccessKey,  // s3/s3-compat/cos/oss: key pair; azure: account name/key
  serviceAccountJson,             // gcs only: the raw service account key or gcloud ADC JSON, as a string
  prefix,            // optional, starting folder, default ""
  name,              // optional, defaults to bucket at save time
  region,            // s3/s3-compat: derived, never asked; tencent-cos/alibaba-oss: required, typed
  endpoint,          // s3-compat only: the host the user typed
  pathStyle,         // legacy/imported connections only, no longer asked for
}
```

**Region auto-detection** (S3 only). Bucket names don't encode a region, but
S3's legacy global endpoint (`https://{bucket}.s3.amazonaws.com/`) reports
the real region in an `x-amz-bucket-region` response header even on an
unauthenticated request — including on the 403 you get without credentials.
`detectBucketRegion()` uses that instead of asking the user, firing on blur
of the bucket field and again at save time if still empty. Falls back to
`us-east-1` if detection fails. It stays editable under Advanced, the only
field left there.

**S3-compatible** asks for exactly two things beyond the key pair: the
endpoint host (a primary field, not tucked under Advanced — it's the one
thing that defines the connection) and the bucket. Region and path-style are
*not* asked:

- Region is only a SigV4 scope string to these services, not a routing
  decision — `regionForEndpoint()` derives it (`"auto"` for R2, which
  requires that exact value; `"us-east-1"` otherwise, which the rest accept
  or ignore).
- Path-style is implied: `usesPathStyle()` is already true whenever an
  endpoint is set, which is always, for this type.

The endpoint is normalized to a bare host (`normalizeEndpoint()` strips a
pasted `https://` and any path), since it's used both to build URLs and as
the `chrome.permissions.request` origin pattern.

**Tencent Cloud COS and Alibaba Cloud OSS**: both speak the same S3 dialect
as `s3`/`s3-compat` — same SigV4 signing, same XML — through their own
documented S3-compatible endpoints, so they reuse `S3Client` rather than
getting their own client. `S3Client#host()` switches on `conn.type` to build
`cos.{region}.myqcloud.com` or `s3.oss-{region}.aliyuncs.com` (bucket goes in
the subdomain, same virtual-hosted style as AWS — no `endpoint` field, so
`usesPathStyle()` stays false). Unlike AWS S3, neither exposes a
region-sniffing global endpoint, so region is a required, always-visible
field instead of an auto-detected Advanced one — with a `<datalist>` of each
provider's public regions (id `tencentCosRegions`/`alibabaOssRegions` in
`static/sidepanel.html`) as suggestions, not a hard constraint, since new regions
ship faster than the extension does. For COS, the bucket name
already includes the APPID suffix the console shows (`my-bucket-1250000000`).
Both hosts are pre-granted in `host_permissions` (`*.myqcloud.com`,
`*.aliyuncs.com`) since, unlike a self-hosted S3-compatible endpoint, the
domain is fixed and known ahead of time.

**Azure Blob Storage**: the connection form takes one field, the storage
account's connection string (`DefaultEndpointsProtocol=...;AccountName=...;
AccountKey=...;...`) — `parseConnectionString()` in `storage/azure.ts`
splits it into the account name/key stored as `accessKeyId`/`secretAccessKey`.
Auth from there is Shared Key: HMAC-SHA256 over Azure's canonicalized-
headers/-resource string (`storage/azure-sig.ts`), and the Blob REST API
(`storage/azure.ts`) — containers instead of buckets, blobs instead of
keys, but the same flat, prefix/delimiter browsing model. Host is derived
from the account name (`{account}.blob.core.windows.net`).

**Google Cloud Storage**: the connection form takes a pasted (or file-picked)
service account JSON key or gcloud ADC file, stored as-is in
`serviceAccountJson`. For ADC (`authorized_user`), the token comes from a
refresh-token exchange instead of the JWT below. `gcp/auth.ts` implements
the JWT Bearer Token flow: sign a JWT with the key's RSA private key
(`RSASSA-PKCS1-v1_5`/SHA-256), exchange it at Google's token endpoint for a
short-lived OAuth2 access token, cache it until near expiry.
`storage/gcs.ts` uses that token (scope `devstorage.read_write`) (`Authorization: Bearer …`) against the
JSON Storage API (`storage.googleapis.com/storage/v1/...`), not the XML API —
JSON responses instead of the XML the other three clients parse.

## Endpoints & permissions

`host_permissions` is pre-granted for the known providers: `*.amazonaws.com`,
`*.r2.cloudflarestorage.com`, `storage.googleapis.com`,
`oauth2.googleapis.com` (GCS token exchange), `*.blob.core.windows.net`,
`*.myqcloud.com` (Tencent COS), `*.aliyuncs.com` (Alibaba OSS), plus
`compute.googleapis.com`, `secretmanager.googleapis.com` and
`cloudresourcemanager.googleapis.com` for the Google Cloud section. A custom
S3-compatible endpoint (MinIO, self-hosted) is the one case requested at
runtime via `chrome.permissions.request` when the connection is saved —
keeps the install-time permission prompt narrow.

## Key flows

- **Browse**: pick a connection → straight into its bucket at `prefix` via
  a delimited listing (`ListObjectsV2` for S3-dialect, `List Blobs` for
  Azure, `objects.list` for GCS); breadcrumb tracks the prefix stack and can
  always jump back to the connection's starting prefix or the bucket root.
- **Download**: get-object → blob → `chrome.downloads.download` on an
  object URL.
- **Copy/Cut/Paste**: Copy or Cut marks item(s) on an in-memory clipboard
  (shown as a status pill); Paste into the current folder issues
  server-side copies (`x-amz-copy-source` for S3-dialect, `x-ms-copy-source`
  + status polling for Azure, `objects.copy` for GCS — folders: walk + copy
  every key under the prefix), then deletes the sources if it was a cut. No
  OS clipboard involved — state lives in the side panel only, cleared on
  cut-and-paste or explicitly.
- **Preview/edit**: image/video/audio/PDF get a presigned/SAS/signed URL as
  the `src`/`href` directly, so the browser streams and range-seeks against
  the provider itself — nothing is buffered through the extension.
  Text/Markdown is fetched as a blob, shown in an editable textarea, and
  written back with put-object on Save; files over 2MB skip this and point
  at Download.
- **Share**: a provider URI (`s3://`, `az://`, `gs://`, `cos://`, `oss://`,
  string only),
  unsigned HTTP URL (works only if the object/bucket is public), or a signed
  URL (`presignUrl()`/`signedUrlV4()` in `aws/sigv4.ts`/`storage/azure-sig.ts`/
  `gcp/auth.ts`, query-string signing) with a chosen expiry.
- **Delete folder**: list every key under the prefix (paginated,
  non-delimited), delete one by one, no batch-delete API call (keeps the
  signer simple — no request body to sign).
