# Connections

Home lists both kinds side by side — storage connections and Google Cloud
accounts are each one card. A card's [✎] opens the matching edit form.

## Add  (the [＋] chooser)

Home's [＋] first asks what kind of thing to add — the two forms take
different credentials, so it's a choice, not a type dropdown that mixes
them:

```
┌──────────────────────────────────────────────┐
│ Add                                          │
│ 🛢 Storage bucket                         ›  │ ← S3, S3-compatible/R2,
│    S3, R2, Azure Blob, GCS, COS, OSS         │   Azure, GCS, COS, OSS
│ ☁ Google Cloud account                   ›  │ ← service account key or
│    VMs, instance groups, buckets, secrets    │   gcloud ADC
│                              ( Cancel )      │
└──────────────────────────────────────────────┘
 Storage bucket       ─▶ the connection form below
 Google Cloud account ─▶ name + credentials JSON (paste or Load from file…),
                         checked against Google before it's saved
```

## Add / edit a storage connection  (`#connectionModal`)

One form for six providers: the fields that don't apply are hidden, and the
labels change — never a separate form per provider.

```
┌──────────────────────────────────────────────┐
│ Add connection                               │
│ Type                        Amazon S3     ▾  │
│ <one-line hint for the chosen type>          │
│ Endpoint            e.g. abc123.r2.cloud…    │ ← S3-compatible only
│ Bucket name         my-bucket                │ ← label changes per type
│ Access key ID                                │   (Azure: account/… )
│ Secret access key   ••••••••         [👁]    │
│ Service account JSON key                     │ ← GCS only
│ ┌──────────────────────────────────────────┐ │
│ │ {"type": "service_account", …}           │ │
│ └──────────────────────────────────────────┘ │
│ Key prefix (optional, starting folder)       │
│                     e.g. logs/2026/          │ ← becomes the panel's root;
│ Name (optional, defaults to bucket name)     │   it never navigates above it
│                     e.g. Personal, Work      │
│ › Advanced                                   │ ← collapsed for S3: Region,
│     Region        auto-detected from bucket  │   "auto-detected" placeholder
│ Keys are stored only in this browser         │   reads as optional; forced
│ (chrome.storage.local).                      │   open + required for COS/OSS
│ ( Manage all connections… )                  │
│ ⊗ <error, inline>                            │
│ [ Delete ]!            ( Cancel )  [[ Save ]] │ ← Delete only when editing
└──────────────────────────────────────────────┘
```

Six types, one shape:

```
 Amazon S3                  bucket · access key · secret
 S3-compatible (R2, MinIO…) + endpoint
 Azure Blob Storage         connection string parsed down to the same fields
 Google Cloud Storage       service account JSON parsed down to the same
                            fields + serviceAccountJson
 Tencent Cloud COS          bucket (incl. APPID) · SecretId/Key · + region
 Alibaba Cloud OSS          bucket · AccessKey ID/secret · + region
```

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
