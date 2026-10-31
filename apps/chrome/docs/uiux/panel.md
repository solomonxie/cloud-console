# The side panel

`static/sidepanel.html` — one panel, ~360px wide. Everything is in it;
there is no options page and no popup.

It is a stack, like the mobile app: Home lists every connection, a row
pushes a resource screen, a row there pushes a detail screen. Back pops one
level and shows the previous screen exactly as it was left (its DOM is only
hidden, never rebuilt) — scroll, filter and selection survive the trip.

## Home

```
┌──────────────────────────────────────────────┐
│ ☁  Cloud Console            [＋] [⬆] [⬇]     │ ← ＋ opens the add chooser
├──────────────────────────────────────────────┤   (connections.md)
│ 🔍 Filter connections                        │ ← only with many connections
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ [S3] Personal                    [★][✎]  │ │ ← one card per connection,
│ │      Amazon S3                           │ │   any vendor; badge + name +
│ │ 🛢 my-bucket                          ›  │ │   vendor; ✎ edits it; ★ pins
│ │                                          │ │   it above the others
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ [R2] Assets                      [☆][✎]  │ │ ← storage: one bucket each,
│ │      S3-compatible                       │ │   so one row
│ │ 🛢 assets-prod                        ›  │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ [GCP] Work                       [☆][✎]  │ │ ← Google Cloud account
│ │       Google Cloud                       │ │   (service account key or
│ │ 🛢 Cloud Storage                      ›  │ │   gcloud ADC): one row per
│ │ 🖥 VM Instances                       ›  │ │   resource kind
│ │ ▦ Instance Groups                     ›  │ │
│ │ 🔑 Secrets                            ›  │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

## Screen header

Every pushed screen shares one header bar:

```
┌──────────────────────────────────────────────┐
│ [←]  my-bucket                  [actions…]   │ ← back pops one level;
│      Personal · Amazon S3                    │   subtitle says where you are
└──────────────────────────────────────────────┘
```

```
 Home ─▶ bucket browser ─▶ [detail sheet]
 Home ─▶ Cloud Storage ─▶ bucket browser
 Home ─▶ VM Instances ─▶ instance detail
 Home ─▶ Instance Groups ─▶ group detail ─▶ instance detail
 Home ─▶ Secrets ─▶ secret detail
```

## Bucket browser

A storage connection's row, or a bucket under a GCP account's Cloud
Storage, opens the same browser:

```
┌──────────────────────────────────────────────┐
│ [←]  my-bucket                               │ ← screen header
│      Personal · Amazon S3                    │
├──────────────────────────────────────────────┤
│ [⟳] [☑] [📋]        [ ⊕ New folder ][ ⬆ Upload ]│
├──────────────────────────────────────────────┤
│ 🛢 my-bucket › logs › 2026                   │ ← every crumb is a button
├──────────────────────────────────────────────┤
│ 🔍 Filter                                    │ ← narrows the loaded rows
├──────────────────────────────────────────────┤
│ 📋 3 items cut                          [✕]  │ ← pill, only while holding
├──────────────────────────────────────────────┤   a clipboard
│ ⟳ Uploading report.pdf…                      │ ← status line, only while
├──────────────────────────────────────────────┤   working
│ ↰  ..                                        │ ← never rises above the
│ 📄 report.pdf                     [★][⧉][✂]  │   connection's own prefix
│    2.4 MB · Sep 14, 2026                     │ ← ★ favorite: pinned under
│ 📁 01/                       [☆][⧉][✂][🗑]   │   "..", above the rest
│ 📁 02/                       [☆][⧉][✂][🗑]   │
│    2.4 MB · Sep 14, 2026                     │   row actions appear on the
│ 🖼 chart.png                      [☆][⧉][✂]  │   row, not behind a ⋯ menu
│    412 KB · Sep 12, 2026                     │
├──────────────────────────────────────────────┤
│              [ Load more… ]                  │ ← paging is explicit; the
├──────────────────────────────────────────────┤   list never auto-grows
│ 2 folders · 128 files · 1.2 GB · more not    │
│ loaded                                       │ ← says when the count is
└──────────────────────────────────────────────┘   partial, rather than
                                                   implying it is the total
```

Folders come first, then files. A folder-marker object (`key` ending in `/`)
is drawn once, as the folder — never twice.

☆/★ favorites (folders or files, by full key, per bucket) are pinned above
everything else in the listing, keeping folders-before-files within each
group; with "Load more" pages, pinning covers what's loaded. ☆ shows only on
hover; ★ always. No stars in select mode.

## Google Cloud screens

Cloud Storage, VM Instances, Instance Groups and Secrets share one shape:

```
┌──────────────────────────────────────────────┐
│ [←]  VM Instances                    [⟳]     │
│      Work · my-project                       │
├──────────────────────────────────────────────┤
│ Project  [ my-proj▏                    ▾ ]   │ ← combobox: type to filter,
│          ┌──────────────────────────────┐    │   or type a project ID
│          │ my-project      My Project   │    │   directly — never a long
│          │ my-project-dev  Dev          │    │   dropdown to scroll
│          └──────────────────────────────┘    │
├──────────────────────────────────────────────┤
│ 🔍 Filter instances                          │ ← narrows the loaded rows
├──────────────────────────────────────────────┤
│ ○ batch-2      us-east1-b     n2-std-4  ★ ›  │ ← favorites pinned on top
│ ● web-1        us-central1-a  e2-medium ☆ ›  │   (☆ only on hover)
└──────────────────────────────────────────────┘
 Cloud Storage rows are the project's buckets ─▶ bucket browser
 Every list (buckets, VMs, groups, secrets) has ☆/★, per account + project;
 a starred VM is also pinned in instance-group member lists
```

VM instance detail:

```
┌──────────────────────────────────────────────┐
│ [←]  web-1               [▶][■][↻] [↗]       │ ← Start / Stop / Reset!
│      us-central1-a · RUNNING                 │
├──────────────────────────────────────────────┤
│ Machine   e2-medium · 2 vCPU · 4 GB          │
│ Disks     web-1  pd-balanced · 10 GB · READY │
│           debian-12-bookworm                 │
│ Network   default / default                  │
│           10.128.0.2 · 34.1.2.3 (PREMIUM)    │ ← internal · external (tier)
│ Labels    env=prod  · Tags http-server       │
│ Created   Sep 14, 2026                       │
├──────────────────────────────────────────────┤
│ Usage · last 6h                              │
│ CPU        ▁▂▂▃▅▃▂▂▁  12%                    │
│ Memory     needs the Ops Agent               │
│ Network    in ▁▁▂▁▃  out ▁▁▁▂▁               │
│ Disk       read ▁▁▁  write ▁▂▁               │ ← needs roles/monitoring.viewer
├──────────────────────────────────────────────┤
│ ( Serial output › )                          │
└──────────────────────────────────────────────┘
```

Instance group detail:

```
┌──────────────────────────────────────────────┐
│ [←]  web-group                               │
│      Managed · us-central1                   │
├──────────────────────────────────────────────┤
│ Size      3 / target 3                       │
│ Template  web-template                       │
│ Ports     http:80                            │
├──────────────────────────────────────────────┤
│ ● web-1  us-central1-a  e2-medium  10.0.0.2› │ ← member ─▶ instance detail
│ ● web-2  us-central1-b  e2-medium  10.0.0.3› │
└──────────────────────────────────────────────┘
```

Secret detail is unchanged: versions, reveal/copy a value, never stored.

## Empty and blocked states

```
 no connection    🏠  Add a connection to get started
                      Click + in the Home header.

 no bucket set    🛢  This connection has no bucket set
                      Edit it and add a bucket name.
                      [ Edit connection ]            ← the fix, in place

 empty folder     📥  This folder is empty
                      Upload a file or drop one here.

 error            ⊗ AccessDenied: … (the provider's own words, verbatim)
```

The status line carries loading and error in the same slot — one line above
the list, never an alert and never a toast that covers a row.

## Toolbar states

```
 [⟳]              always available once a client exists
 [☑]  select      ·  disabled until a bucket is set; active = filled
 [📋] paste       ·  disabled with an empty clipboard, and when the
                     clipboard belongs to another connection:
                     title = "Clipboard has items from a different connection"
 [New folder]     ·  disabled without a bucket
 [Upload]         ·  disabled without a bucket
```

## Select mode

```
 [☑] ↓
┌──────────────────────────────────────────────┐
│ ☑ 3 selected             [⧉] [↔] [🗑] [✕]    │ ← select-all is the same
├──────────────────────────────────────────────┤   checkbox, indeterminate
│ ☑ 📁 01/                                     │   when partial
│ ☐ 📄 report.pdf                              │
└──────────────────────────────────────────────┘
 per-row actions disappear in select mode — the bar owns them now
 bulk buttons are disabled at 0 selected
```

## Drag and drop

```
 drag files over the list ⇒ the list itself highlights (drag-over)
 drop ⇒ each file uploads into the current prefix, one at a time, with
        "Uploading <name>…" on the status line; one failure doesn't stop
        the rest
```
