# Components

Reusable across Home, Add connection, and resource browser screens.
Cards throughout: `.listStyle(.insetGrouped)`, not plain rows on white.

## Connection row (Home)

```
╭──────────────────────────────────╮
│ 🟧  Prod AWS                    › │
│     AWS · added Sep 19           │
├──────────────────────────────────┤
│ 🟧  Personal S3                 › │
│     AWS · added Sep 20           │
╰──────────────────────────────────╯
```

- 🟧 = `VendorBadge` — rounded-rect icon tile, filled with the vendor's
  accent color (AWS orange, Azure blue, GCP red, Tencent teal, Alibaba
  pink), same shape language as iOS Settings rows.
- Subtitle is always `vendor · added <date>`, never a status glyph — a
  connection either exists (it passed its STS check at add-time) or it
  doesn't; per-call failures surface inline where they happen.
- Sections only appear per-vendor once that vendor has ≥1 connection —
  no empty "Azure" header sitting above a real "AWS" section.

## Empty / error states — `ContentUnavailableView` everywhere

```
empty   ☁                          error   ⚠
        No connections yet                 Couldn't load buckets
        Add a cloud account with           AccessDenied: User is
        an access key — this app           not authorized to
        only does what that key            perform s3:ListBucket
        can do.
        [[ Add connection ]]               ( Retry )
```

- Native `ContentUnavailableView` (label + description + actions), not
  a hand-rolled VStack — same look Files/Mail/Settings use, free
  accessibility and dark-mode handling.
- One sentence in the description, never a paragraph.
- Loading stays a plain centered `ProgressView` with a label
  ("Loading buckets…") — `ContentUnavailableView` is for a *resolved*
  empty/error state, not "still working."

## Resource row (connection detail)

```
╭──────────────────────────────────╮
│ 🟧  S3 Buckets                  › │   ← implemented: badge in vendor
├──────────────────────────────────┤     color, navigable
│ ⬜  EC2 Instances    Coming soon  │   ← not yet: gray badge, no
│ ⬜  Lambda Functions Coming soon  │     chevron, status on the right
╰──────────────────────────────────╯
```

## Access key field (Add connection)

```
Access key ID
┌─────────────────────────────┐
│                              │
└─────────────────────────────┘
Secret access key
┌─────────────────────────────┐
│ ••••••••••                  │
└─────────────────────────────┘

Stored only in this device's Keychain. This app only ever does
what this key's own permissions allow.
```

- One key pair per connection, always. No dual-key, no CI/device
  split — this app has no CI to split against.
- Footer states the security property in plain language every time;
  the (i) next to "Access key" carries the rest (where to find one,
  what to scope it to).
- "Test & add" runs STS `GetCallerIdentity` before saving — proves the
  key is live without assuming S3 access (a key scoped to only
  EC2/Lambda should still pass). Failure keeps the sheet open, fields
  intact, error shown inline — never silently discards what was typed.

## Bucket row (region-tagged)

```
╭──────────────────────────────────╮
│ 🟧  my-logs-bucket              › │
│     us-west-2                    │
├──────────────────────────────────┤
│ 🟧  my-assets-bucket            › │
│     eu-central-1                 │
╰──────────────────────────────────╯
         2 buckets            ← footer, held back until region
                                 lookups resolve for every row
```

- Region always shown under the name — fetched via `GetBucketLocation`
  right after `ListBuckets`, never left blank.

## Folder/object row (bucket browser)

```
╭──────────────────────────────────╮
│ 📁 2026/                        › │
│ 📁 archive/                     › │
├──────────────────────────────────┤
│ 📄 notes.txt              4.1 KB │
│ 📄 report.pdf              1.2 MB │
╰──────────────────────────────────╯
     2 folders · 2 items · 1.2 MB   ← footer, hidden until the listing
                                       resolves; on failure, no stats
                                       line at all (not a stale/blank one)
```

- Recurses into the same screen — tapping a folder pushes another
  `BucketObjectsView` at the deeper prefix, not a different screen
  type. Same list style, same footer shape, every level.
- Long names truncate in the middle (`report-2026-quart…-final.pdf`),
  never wrap and break the row height.
