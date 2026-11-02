# Connections

A connection is a **cloud vendor + one key** — never a bucket. Its buckets
are listed from the account; the form only optionally limits it to one
bucket (and a prefix inside it). Home shows one card per connection, its
rows the resources picked in the form. A card's [✎] opens the matching
edit form.

## Add  (the [＋] chooser)

Home's [＋] lists cloud vendors, like the mobile app's provider picker.
Only vendors with at least one implemented Chrome resource kind appear
(`availableVendors("chrome")` in packages/core/src/catalog.ts) — never a
"coming soon" row:

```
┌──────────────────────────────────────────────┐
│ Add connection                               │
│ ☁ Amazon Web Services                    ›  │ ← accent per vendor
│    S3 buckets                                │
│ ☁ Google Cloud                           ›  │ ─▶ account dialog
│    Cloud Storage, VMs, Cloud Run, secrets…   │    (gcp/screens.ts)
│ ☁ Microsoft Azure                        ›  │
│    Blob containers                           │
│ ☁ Alibaba Cloud                          ›  │
│    OSS buckets                               │
│ ☁ Tencent Cloud                          ›  │
│    COS, CVM, CAM, EventBridge, billing       │
│ ☁ S3-compatible                          ›  │
│    Cloudflare R2, MinIO…                     │
│                              ( Cancel )      │
└──────────────────────────────────────────────┘
 Google Cloud ─▶ name + credentials (Link a file / Paste JSON) + Resources
 any other    ─▶ the connection form below, for that vendor
```

## Add / edit a storage connection  (`#connectionModal`)

One form, shown for the vendor picked in the chooser: no type dropdown,
the title names the vendor, and only that vendor's key fields show.
**No bucket field** — buckets are listed from the account.

```
┌──────────────────────────────────────────────┐
│ Add Amazon Web Services                      │
│ Name (optional)     e.g. Personal, Work      │
│ <one-line hint for the vendor>               │
│ Endpoint            e.g. abc123.r2.cloud…    │ ← S3-compatible only
│ Access key ID                                │ ← per vendor: SecretId,
│ Secret access key   ••••••••         [👁]    │   AccessKey ID/secret;
│                                              │   Azure: connection string
│ › Advanced                                   │ ← AWS: region, optional;
│     Region        auto-detected per bucket   │   forced open + required
│                                              │   for COS/OSS
│ ┌ Resources ───────────────────────────────┐ │
│ │ [x] S3 Buckets                           │ │ ← one per implemented kind
│ │     Limit to (optional) — leave empty to │ │   (resourceKinds(vendor,
│ │     list every bucket this key can see.  │ │   "chrome")); all checked
│ │     Bucket name     all buckets          │ │   by default, ≥1 required
│ │     Prefix          e.g. logs/2026/      │ │ ← enabled once a bucket is
│ └──────────────────────────────────────────┘ │   typed; the hard root
│ Keys are stored only in this browser         │
│ (chrome.storage.local).                      │
│ ⊗ <error, inline>                            │
│ [ Delete ]!            ( Cancel )  [[ Save ]] │ ← Delete only when editing
└──────────────────────────────────────────────┘
```

Save checks the key against the provider first: with a "Limit to" bucket
it lists that bucket under the prefix (works for keys without ListBuckets);
otherwise it lists the account's buckets.

```
 Vendor                key fields                         storage type
 Amazon Web Services   access key ID · secret             s3
 Microsoft Azure       connection string                  azure
 Alibaba Cloud         AccessKey ID/secret · region       alibaba-oss
 Tencent Cloud         SecretId/SecretKey · region        tencent-cos
 S3-compatible         endpoint · key · secret            s3-compat
```

Stored on the connection: `resources` (absent = all) and `storageScope:
{ bucket?, prefix? }`. Connections saved when each was pinned to one bucket
load as `storageScope: { bucket, prefix }` — they still open straight into
that bucket.

## Google Cloud account dialog

Name, credentials (Link a file / Paste JSON), then the same Resources
section: a checkbox per implemented GCP kind (Cloud Storage, VM Instances,
Instance Groups, Cloud Run, Secrets — straight from the catalog). Home
shows only the checked ones.

## Manage  (`#manageModal`)

```
┌──────────────────────────────────────────────┐
│ Manage connections                           │
│ Personal — my-bucket                    [✎]  │
│ Work — logs/2026/                       [✎]  │
│ No connections yet.                          │
│                              [[ Close ]]     │
└──────────────────────────────────────────────┘
```

## Export / import

```
 [⬆]  writes every connection out as one JSON file (keys included — it is
      a backup of the whole thing, not a share link)
 [⬇]  picks a JSON file  ⇒ Imported 3 connection(s).
      ⊗ <parse error, on the status line>
```
