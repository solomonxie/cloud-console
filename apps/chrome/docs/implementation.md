# Implementation notes

Companion to [design.md](design.md) — what's actually built and how to work
on it.

## Files

Storage logic lives in `packages/core` (shared with the mobile app); the
extension holds only the UI. Paths below are relative to the repo root for
core, to `apps/chrome/` otherwise.

| File | Responsibility |
|---|---|
| `static/manifest.json` | MV3 manifest: side panel, permissions, icons |
| `static/sidepanel.html` | markup: the screen stack host, the bucket browser's `<template>`, `<dialog>` modals |
| `static/sidepanel.css` | all styling, no preprocessor (`gcp.css` for the Google Cloud screens) |
| `src/background.ts` | one call: opens side panel on action click |
| `src/app/nav.ts` | stack navigator: `push()`/`pop()`/`home()`, shared screen header (back, title, subtitle, actions) |
| `src/app/home.ts` | Home: one card per connection (storage + Google Cloud), the [＋] chooser, export/import |
| `src/sidepanel/bucket-screen.ts` | the bucket browser as a pushed screen, mounts its template, wires every module |
| `src/sidepanel/state.ts` | the bucket browser's `state` + `activeConnection()`/`rootPrefix()` |
| `src/sidepanel/dom.ts` | `els` lookups, `setStatus()`/`withStatus()`, `escapeHtml()`, `formatDate()` |
| `src/sidepanel/connections.ts` | picker, add/edit form (`TYPE_META`), manage list, export/import |
| `src/sidepanel/browser.ts` | breadcrumb, listing/pagination, rows, multi-select, delete/upload/new folder |
| `src/sidepanel/clipboard.ts` | copy/cut/paste |
| `src/sidepanel/preview.ts` | detail sheet: metadata, media preview, text/Markdown editor |
| `src/sidepanel/share.ts` | Share modal: URI, unsigned link, signed link |
| `src/sidepanel/dialogs.ts` | `confirmDialog()`, `promptDialog()`, backdrop-click close |
| `src/lib/store.ts` | connections CRUD in `chrome.storage.local` |
| `src/lib/icons.ts` | inline-SVG icon set (`icon()`) + `iconForFileName()` by extension |
| `src/lib/markdown.ts` | `renderMarkdown()` — dependency-free Markdown → HTML |
| `src/gcp/screens.ts` | Google Cloud screens: Cloud Storage, VM instances, instance groups, secrets, and their detail screens |
| `src/ui/search.ts` | `filterBox()` over loaded rows, project combobox, `matches()` |
| `packages/core/src/aws/sigv4.ts` | `signRequest()` — AWS Signature V4; `presignUrl()` — query-string presigning |
| `packages/core/src/gcp/auth.ts` | `getAccessToken()` — JWT Bearer / refresh-token flow; `signedUrlV4()`; `credentialsProblem()` |
| `packages/core/src/storage/types.ts` | `StorageClient` interface, `ListPage`, `StorageObject` |
| `packages/core/src/storage/connection.ts` | `StorageConnection`, `exportConnections()`/`parseImport()`, prefix/endpoint normalizers |
| `packages/core/src/storage/client.ts` | `createClient(conn)` — picks `S3Client`/`AzureClient`/`GcsClient` by `conn.type` |
| `packages/core/src/storage/s3.ts` | `S3Client` — S3-dialect REST calls + `parseListObjects()`, `detectBucketRegion()` |
| `packages/core/src/storage/azure-sig.ts` | `signRequest()` — Azure Shared Key; `presignUrl()` — Service SAS |
| `packages/core/src/storage/azure.ts` | `AzureClient` — Blob REST calls, `parseListBlobs()`, `parseConnectionString()` |
| `packages/core/src/storage/gcs.ts` | `GcsClient` — JSON Storage API calls |
| `packages/core/src/storage/xml.ts` | `fast-xml-parser` wrapper + helpers |
| `packages/core/src/storage/walk.ts` | recursive `deletePrefix()`/`copyPrefix()` shared by all clients |
| `packages/core/src/storage/format.ts`, `preview.ts` | `formatSize()`; `previewKind()`, `isTooLargeForTextPreview()`, `mimeForName()` |
| `packages/core/src/util/base64.ts` | pure-JS base64 (Azure keys/signatures) |
| `build.mjs` | esbuild: bundles `src/` (+ core) into `dist/`, copies `static/` |
| `scripts/gen_icons.py` | `icon{16,32,48,128}.png` from the mobile app icon: headless Chrome rounds the corners, `sips` resizes |

## SigV4 signer (`core/aws/sigv4.ts`)

`signRequest({ method, url, region, service, accessKeyId, secretAccessKey, headers, payloadHash })`
returns the full header set including `Authorization` (minus `host`, which
`fetch` sets). Notes:

- SHA-256 / HMAC come from `@noble/hashes` (`core/crypto/hash.ts`), so the
  same code runs in Chrome and in React Native, synchronously.
- `payloadHash` defaults to the well-known empty-body hash (GET/HEAD/DELETE).
  Uploads (`PutObject`) pass the literal string `"UNSIGNED-PAYLOAD"` instead
  of hashing the body — avoids reading large file blobs twice.
- Canonical query string sorts params; canonical URI percent-encodes each
  path segment per the AWS spec (`encodeRFC3986`, extra-encodes `! ' ( ) *`).
- `presignUrl({ method, url, region, accessKeyId, secretAccessKey, expiresIn })`
  signs into the query string (`X-Amz-Signature` etc.) instead of a header,
  so the returned URL works standalone (pasted into a browser, `<img src>`,
  `<video src>`). Payload hash is always `UNSIGNED-PAYLOAD` — presigned URLs
  are GETs, no body.

## Client dispatch (`core/storage/client.ts`)

`createClient(conn)` picks `AzureClient`, `GcsClient`, or `S3Client` by
`conn.type` (`"s3"`/`"s3-compat"`/`"tencent-cos"`/`"alibaba-oss"` fall
through to `S3Client`). All three implement `StorageClient` (`types.ts`), so
the side panel calls `state.client.listObjects(...)` etc. without ever
branching on type itself. `listObjects` returns `{ folders, objects,
nextToken }` — `nextToken` is set only when there's another page.

## S3 client (`core/storage/s3.ts`)

Backs `"s3"` and `"s3-compat"` connections. `new S3Client(connection)` then:

- `listObjects(bucket, prefix, token)` → one page (`PAGE_SIZE = 100`),
  `delimiter=/`; pass the previous page's `nextToken` to page forward.
- `listAllKeys(bucket, prefix)` → async generator, no delimiter, paginates
  via `NextContinuationToken`; used by `deletePrefix()` and `copyPrefix()`.
- `getObjectBlob`, `deleteObject`, `copyObject`, `moveObject` (copy+delete),
  `copyPrefix` (walks `listAllKeys` and copies each to the same relative
  path under a new prefix — recursive folder copy/paste), `putObject`,
  `createFolder` (zero-byte key ending in `/`).
- `resourceUri`, `unsignedUrl`, `presignedUrl` — the three link kinds the
  Share modal offers; `presignedUrl` delegates to `sigv4.ts#presignUrl`.
  `scheme` (`"s3"`) labels the Share modal's URI row.

`detectBucketRegion(bucket)` is a standalone export (no credentials needed,
S3 type only): an unauthenticated `HEAD` to `https://{bucket}.s3.amazonaws.com/`
gets a `x-amz-bucket-region` response header even on the 403 you get without
auth. Used by the connection form to fill in region without asking the user.

`request()` turns a non-2xx response into an `Error` using the `<Code>`/
`<Message>` from the XML error body (e.g. `"AccessDenied: ..."`) when
present, instead of dumping the raw XML — that string is what ends up in the
status bar / form status via `withStatus()`/`setFormStatus()`.

Virtual-hosted vs. path-style URLs: `usesPathStyle()` is true when
`connection.pathStyle` is set or an `endpoint` is present — which covers
every `"s3-compat"` connection, so the form doesn't ask about path style at
all; `pathStyle` now only ever comes from an older or imported connection.
Otherwise AWS virtual-hosted `bucket.s3.region.amazonaws.com` is used.

XML responses are parsed with `fast-xml-parser` (`xml.ts`) rather than
`DOMParser`, which React Native lacks. Values are kept as raw strings — no
number coercion (a key `0001` stays `0001`), no trimming — and a single
`<Contents>` still comes back as a one-element list.

## Azure client (`core/storage/azure.ts`, `core/storage/azure-sig.ts`)

Backs `"azure"` connections. The connection form takes one field, the
storage account's connection string; `parseConnectionString()` splits it
into `accessKeyId`/`secretAccessKey` (account name/key) at save time — see
`saveConnectionFromForm()` below. The host is derived
(`{account}.blob.core.windows.net`), no custom endpoint field. Same method
surface as `S3Client` (`listObjects`, `getObjectBlob`, `copyObject`, …),
mapped onto the Blob REST API — containers instead of buckets, `List Blobs`
instead of `ListObjectsV2`, `PUT` with `x-ms-blob-type: BlockBlob` for
uploads.

`azure-sig.ts#signRequest()` implements Shared Key auth: HMAC-SHA256 over
Azure's canonicalized-headers/-resource string, base64 account key
(decoded/encoded by `core/util/base64.ts`, no `atob`/`btoa` dependency),
`Authorization: SharedKey {account}:{signature}`. `presignUrl()` builds a
read-only Service SAS (query-string signed, `sv`/`sr`/`sp`/`se`/`sig`
params) — the Azure equivalent of an S3 presigned URL, GET only, same as
the Share modal's other "signed link" option. `scheme` is `"az"`.

`copyObject` uses server-side `x-ms-copy-source` + polls
`x-ms-copy-status` on the destination until it settles — same-account only
(a cross-account copy would need a source SAS, not implemented, matching
this app's same-connection clipboard model — see design.md).

`Content-Length` can't be set on a `fetch()` request (forbidden header
name) but Shared Key requires it in the signature — `bodyLength()` computes
it from the body and it's threaded through `request()`'s `contentLength`
option purely for signing; the browser sends the matching real length on
the wire automatically.

## GCS client (`core/storage/gcs.ts`, `core/gcp/auth.ts`)

Backs `"gcs"` connections. The connection form takes a pasted service
account JSON key or gcloud ADC file, stored as-is (string) in
`conn.serviceAccountJson` —
`GcsClient`'s constructor `JSON.parse()`s it. No `accessKeyId`/
`secretAccessKey` for this type.

`auth.ts#getAccessToken(creds, scope)` implements the JWT Bearer Token
flow (RFC 7523) for a service account — an RS256 JWT signed with its
private key, exchanged at Google's token endpoint — or the refresh-token
exchange for gcloud user credentials, and caches the token until shortly
before it expires. `GcsClient` asks for scope `devstorage.read_write` and
sends the token as `Authorization: Bearer …`. `canSign(creds)` is false for
user credentials, which drives `canPresign`.

`auth.ts#signedUrlV4()` is the Share modal's signed-link option:
GOOG4-RSA-SHA256, structurally the same canonical-request/string-to-sign
shape as `sigv4.ts#presignUrl()` but RSA-signed (not HMAC) and always
scoped to the pseudo-region `"auto"`.

`GcsClient` talks to the **JSON** Storage API
(`storage.googleapis.com/storage/v1/...`), not the XML API the other
clients use — `listObjects`/`listAllKeys` parse `{ items, prefixes,
nextPageToken }` JSON instead of XML; `size` comes back as a
string (int64) and needs `Number()`. Uploads go through the separate
`/upload/storage/v1/...` endpoint with `uploadType=media` (simple upload —
fine for this app's file sizes; a resumable upload would be needed for very
large files, out of scope, see design.md's non-goals). Copy is
`POST .../o/{srcObject}/copyTo/b/{dstBucket}/o/{dstObject}`, synchronous, no
polling needed (unlike Azure's async copy).

## Storage (`src/lib/store.ts`, `core/storage/connection.ts`)

Single `chrome.storage.local` key `"connections"`, an array (Google Cloud
accounts live under their own `"gcpAccounts"` key, `src/gcp/accounts.ts`).
The stored shape is `StorageConnection` — unchanged from the plain-JS extension, so saved
connections and old export files keep loading.
`exportConnections()`/`parseImport()` round-trip `{ version: 1, connections: [...] }`
as downloadable/importable JSON — secrets included, plaintext, by design (see
design.md).

## Navigation (`src/app/`)

`nav.ts` is a stack navigator, like the mobile app's: Home → a resource
screen → a detail screen. A `Screen` gets an empty body and the shared
header on `push()`; going back pops it and re-shows the previous screen
exactly as it was left (its DOM is only hidden, never rebuilt). `home.ts`
renders the root: one card per connection, any vendor, each row pushing
that resource's screen — `bucket-screen.ts` for a storage connection,
`gcp/screens.ts` for a Google Cloud account's resources. Long lists use
`ui/search.ts`: a filter box over loaded rows, and a combobox for projects.

## Bucket browser (`src/sidepanel/`)

Single mutable `state` object (`connections`, `activeId`, `client`, `bucket`,
`prefix`, `token`), re-rendered imperatively — no framework, no virtual DOM.
`state.bucket`/`state.prefix` seed from the active connection's `bucket`/
`prefix` in `onConnectionChanged()`; all further movement goes through
`navigateToPrefix()` so the breadcrumb and list stay in sync. A connection
saved before the bucket-scoped model (no `bucket` field) doesn't crash — the
breadcrumb skips the bucket crumb and the file list shows an "Edit
connection" prompt instead of trying to list objects.

Rows are built with `makeRow()`; the connection form's Save button runs a
real validation before persisting anything — see below.

Object keys ending in `/` (S3 "folder marker" objects) are filtered out of
the file rows — they're represented by the `CommonPrefixes` folder row
instead.

Destructive actions (delete, recursive folder delete, discarding unsaved
edits) confirm via `confirmDialog()`, and new-folder naming uses
`promptDialog()` — both built on `<dialog>` (matching the connection/manage
modals) instead of `window.confirm`/`window.prompt`, so they pick up the
extension's own styling and dark-mode colors rather than the browser's
native alert chrome. Copy/move destinations are no longer a prompt — see
Clipboard copy/cut/paste below.

Files get a type-specific icon (`iconForFileName()` in `src/lib/icons.ts`, keyed
off extension) instead of one generic file glyph. Dropping files onto the
list uploads them (`dragover`/`drop` on `#fileList`), same code path as the
Upload button.

## Connection form (`openConnectionModal()`, `saveConnectionFromForm()`)

The `#connType` select drives everything else in the form: `TYPE_META` maps
each type to its field labels and which fields apply —
`showAccessKey`/`showSecretKey` (S3 shows both as key ID/secret; Azure shows
only the secret field, relabeled "Connection string"; GCS shows neither),
`showServiceAccountJson` (GCS only, a `<textarea>`), `showEndpoint`
(S3-compatible only, a primary field), and `showRegion` (S3 only, the lone
field left under Advanced). `applyTypeToForm()` applies that (labels,
`hidden`, `required`) on open and on every `#connType` change.

Save doesn't just persist the form — it proves the connection actually
works first, with each step reflected in `#connFormStatus` (spinner icon +
text, via `setFormStatus()`, the same `applyStatus()` helper the main status
bar uses):

1. Type-specific setup, building `conn` from the raw form fields:
   - **s3**: detects region if blank (`detectBucketRegion()`, "Detecting
     region…").
   - **s3-compat**: `normalizeEndpoint()` on the typed host,
     `regionForEndpoint()` for the SigV4 scope, then requests runtime
     permission for that endpoint.
   - **azure**: `parseConnectionString()` on `#connSecretKey`'s value (the
     connection string) → `accessKeyId`/`secretAccessKey`; a parse failure
     (missing `AccountName`/`AccountKey`) shows in the form and stops here.
   - **gcs**: `JSON.parse()`s `#connServiceAccountJson`'s value, checks it
     with `credentialsProblem()`, and stores the raw string as
     `conn.serviceAccountJson`; a parse/shape failure stops here too.
   - GCS/Azure need no permission request (pre-granted hosts — see
     design.md).
2. `createClient(conn).listObjects(...)` against the real bucket/prefix
   ("Checking bucket access…") — this is a throwaway client for the
   in-progress form values, not `state.client`. For GCS this is also the
   first real exercise of the JWT → access-token exchange.
3. Only on success does it call `upsertConnection()` and close the dialog;
   on failure the error shows in the modal and the dialog stays open so the
   user can fix it. The Save button is disabled for the duration to prevent
   double-submits.

## Clipboard copy/cut/paste (`src/sidepanel/clipboard.ts`)

`state.clipboard` is `{ items, cut, bucket, connectionId }` or `null` — no OS
clipboard involved, it's in-memory UI state. `setClipboard()` (from a row's
Copy/Cut button, the bulk bar, or the detail sheet) fills it and shows the
`#clipboardPill` status indicator; `pasteClipboard()` copies each item into
`state.prefix` (`copyObject`/`copyPrefix`, S3 or Azure per the connection), then deletes the
sources if `cut` is set. Guards: a paste that would land exactly where an
item already is, or nest a folder inside itself, is skipped rather than
erroring. `updateClipboardUI()` disables Paste when the clipboard holds
items from a different connection than the active one (its credentials may
not have access to the source bucket).

## Object preview & editing (`src/sidepanel/preview.ts`, `core/storage/preview.ts`)

`previewKind(name)` decides what `renderDetailPreview()` shows in the detail
sheet:

- `image`/`video`/`audio`/`pdf` → a presigned/SAS URL (`client.presignedUrl`)
  as the element's `src`, so the browser fetches/streams/seeks directly —
  the extension never holds the file in memory. PDFs also get an "Open in a
  new tab" fallback link in case the inline `<iframe>` doesn't render.
- `text`/`markdown` → `getObjectBlob().text()` into an editable `<textarea>`
  (skipped, with a "too large" note, past `isTooLargeForTextPreview()`'s 2MB
  cutoff); Markdown adds a Preview/Source toggle backed by
  `src/lib/markdown.ts#renderMarkdown()`.

`editorState` (module-level, one at a time) tracks `{ key, mimeType,
original, el }` for the open text editor; `markEditorDirty()` compares
`el.value` to `original` to enable/disable Save, and `saveEditor()` writes
back via `putObject` with `mimeForName()`'s content-type. Closing the sheet
(button, Escape, or backdrop click) while dirty prompts to discard instead
of losing the edit — see `closeDetailModal()`.

## Adding a new bucket operation

1. Add it to `StorageClient` (`core/storage/types.ts`), then implement it in
   `S3Client` (`s3.ts`), `AzureClient` (`azure.ts`) and `GcsClient`
   (`gcs.ts`) — each using its own `this.request()` (handles auth + error
   surfacing) — so the UI can call it without branching on type.
2. Wire a UI trigger in `src/sidepanel/` (toolbar button or row action),
   using the `withStatus()` helper so busy/error states show in the status
   bar.

## Adding a screen

Implement a `Screen` (`{ title, subtitle?, render(body, header) }`, see
`src/app/nav.ts`) and `nav.push()` it from a row on Home or on another
screen. `render` gets an empty body below the header; build into it with
plain DOM, and put icon buttons in `header.actions`.

## Testing this locally

See the [README](../README.md#development) for `make build` / load-unpacked
steps. `make lint` type-checks the extension (`tsc --noEmit`). The storage
clients' pure parts — S3/Azure XML list parsing against fixture responses,
Azure Shared Key/SAS signatures at a fixed date, connection-string and
export-file parsing — are unit-tested in `packages/core/test/`
(`npx vitest run` there).
