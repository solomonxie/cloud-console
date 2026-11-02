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
│ │ [S3] Personal                 [★][✎] ›   │ │ ← one card per connection,
│ │      AWS S3 · 7 resources                │ │   collapsed to its header;
│ └──────────────────────────────────────────┘ │   ✎ edits it; ★ pins it
│ ┌──────────────────────────────────────────┐ │   above the others
│ │ [R2] Assets                   [☆][✎] ˅   │ │ ← clicking the header opens
│ │      S3-compatible · 1 resource          │ │   it (remembered per card):
│ │ 🛢 Buckets                            ›  │ │   rows = the resources picked
│ │      assets-prod/public/                 │ │   in the form; a "Limit to"
│ └──────────────────────────────────────────┘ │   bucket is the row's detail
│ ┌──────────────────────────────────────────┐ │
│ │ [GCP] Work                    [☆][✎] ˅   │ │ ← Google Cloud account
│ │       Google Cloud · 6 resources         │ │   (service account key or
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
 Home ─▶ Buckets ─▶ bucket browser ─▶ [detail sheet]
 Home ─▶ bucket browser          (connection limited to one bucket)
 Home ─▶ Cloud Storage ─▶ bucket browser
 Home ─▶ VM Instances ─▶ instance detail
 Home ─▶ Instance Groups ─▶ group detail ─▶ instance detail
 Home ─▶ Secrets ─▶ secret detail
```

## Buckets

A storage connection's bucket row, when it isn't limited to one bucket:
every bucket (Azure: container) the key can list, from the provider's own
account-level call (packages/core/src/storage/buckets.ts).

```
┌──────────────────────────────────────────────┐
│ [←]  Buckets                       [⟳]       │
│      Personal                                │
│ 🔍 Filter by name or region                  │
│ 🗄 alpha-photos                     [☆]   ›  │ ← AWS/COS/OSS: the bucket's
│    eu-west-1 · created 6/15/2025             │   own region; the browser
│ 🗄 zeta-logs                        [☆]   ›  │   signs for it
│    us-west-2 · created 4/1/2026              │
│                 2 of 14 buckets              │ ← "N of M" while filtering
└──────────────────────────────────────────────┘
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

## Cloud Run

Two Home rows per Google Cloud account — **Cloud Run Services** and
**Cloud Run Jobs** — each a project-picker list across every region.

```
 Services list                            Jobs list
┌──────────────────────────────────────┐ ┌──────────────────────────────────────┐
│ 📦 api                     ready  [↗]│ │ ▶ nightly-export          ready  [↗]│
│    us-central1 · api@sha256:1a2b3c4 · │ │    europe-west1 · tasks 4 · last run │
│    all                               │ │    succeeded 10/30/2026, 02:00       │
└──────────────────────────────────────┘ └──────────────────────────────────────┘
 pill: ready (ok) · failed (off) · pending (busy); favorites id = region/name

 Service detail                     [⟳] [↗]
   ready · us-central1 · api-00042-xyz
   (not ready ⇒ terminal condition message on a status line)
   URL         https://api-….run.app  [⧉] [↗ new tab]
   Containers  image, CPU / memory, CPU mode (always allocated vs only
               during requests), ports, env var NAMES only — values are
               never shown; secret refs read "secret: name:version"
   Details     min/max instances, concurrency, timeout, ingress,
               service account, last modified at/by, labels
   Traffic     100%  latest (api-00042-xyz)  [tag]
   Revisions   newest first: id, serving %, ready pill, created · image

 Job detail                         [⟳] [↗]
   ready · europe-west1                       [▶ Run now]
   Details     tasks, parallelism, task timeout, retries, service account,
               execution count, labels
   Containers  as above (no CPU mode)
   Executions  newest 20: id, status pill, [↗ logs], started · duration,
               succeeded/total, failed, running, cancelled

 Run now ⇒ confirm "Starts a new execution with the job's saved
   configuration. It's billed like any run." ⇒ "Execution started" ⇒
   executions reload; the list's "last run" refreshes on return.
   Permission errors name the role (run.jobs.run / roles/run.developer).
```

## AWS

An AWS connection's card lists S3 Buckets plus every other AWS kind the
mobile app has (src/aws/*, registered per kind in app/kind-screens.ts):
Billing, IAM Users, IAM Roles, EC2 Instances, Lambda Functions,
EventBridge, Parameter Store. Same key, straight to AWS; listings are
cached for the browser session (chrome.storage.session, the shared
app/resource-cache.ts), keyed `aws:<kind>[@region]:<connection id>`.

```
 Regional list (EC2, Lambda, EventBridge, Parameter Store)   [⟳]
 ┌──────────────────────────────────────────┐
 │ 🔍 Filter by name, ID, type, state…      │  (once something loaded)
 │ ◌ Scanning eu-west-1 (5/17)…  ⚠ 2 failed │  ⇒ when done:
 │                                          │    "12 instances · 17 regions"
 │ ┌ Regions that failed ─────────────────┐ │  (toggled by "⚠ N failed")
 │ │ ap-east-1  AuthFailure: …            │ │
 │ └──────────────────────────────────────┘ │
 │ us-east-1  N. Virginia           [3] ⌄   │  click folds the region
 │ ┌──────────────────────────────────────┐ │
 │ │ ▣ web-1                     running ☆│ │
 │ │   i-0abc… · t3.small                 │ │
 │ └──────────────────────────────────────┘ │
 └──────────────────────────────────────────┘
 Regions are scanned one at a time (us-east-1, us-west-1, Canada, then
 the rest); the last cached result per region shows first. Empty regions
 are hidden. Filtering hides groups with no match and shows "n/m" counts.
 Favorites scope aws:<conn>:<kind>, id = region/<id>.

 Global list (IAM Users / Roles): filter, rows (name · ARN), "N of M",
 favorites, [⟳].

 EC2 instance                                              [⟳]
   running · t3.small
   Details        instance ID, type, state, name, launched, region
   Status checks  System / Instance / Attached EBS  (OK · Impaired ·
                  Initializing · Insufficient data · N/A pills)
   Health · last 3 h  CPU, Memory*, Disk used (/)*, Network in/out,
                  Disk read/write — sparkline tiles, hover for a value;
                  * "Needs CloudWatch agent" when missing.
                  Refreshes every minute. No start/stop (mobile has none).

 Lambda function
   Details   function, description, runtime, handler, memory, timeout,
             code size, last modified, ARN, region
   Input (JSON event)  textarea (last input remembered per function),
             "Not valid JSON." disables [▶ Run]
   [▶ Run] ⇒ confirm "This executes the function for real…" ⇒
   Logs      live CloudWatch tail of this run (polled every 2 s until its
             REPORT line, ≤20 s grace); error lines in red
   Response  Succeeded · 200 / Error · Unhandled pill + pretty JSON

 IAM user / role
   Details            name, ARN, path, created
   Attached policies  each a fold; the JSON document loads on first open
   Inline policies    same

 EventBridge item (rule / schedule / event bus)
   Details  fields from DescribeRule / GetSchedule / DescribeEventBus
   Event pattern, Target · <id>, Policy — JSON blocks

 Parameter
   Value    String/StringList: loaded on open, [⧉] copy.
            SecureString: [👁 Reveal] decrypts on click; [Hide] drops it
            from the DOM. Never cached or stored.
   Details  name, type, data type, tier, version, modified (by),
            description, KMS key, region

 Billing   month to date, by service, 11 months of history (folds);
           a service drills into its bill by usage and by resource.
```

## Tencent Cloud

A Tencent connection (SecretId/SecretKey, region optional) shows COS
buckets plus the same kinds as the mobile app, read-only, built on the
shared kind screens in src/app/ (list-, regional-, detail-, principal- and
billing-screen.ts). Every row in a list has a ☆ that pins it; favorites
scope `tencent:<conn>:<kind>`.

```
 CVM Instances                                         [⟳]
 ┌──────────────────────────────────────────┐
 │ 🔍 Filter by name, ID, type, state…      │
 │ ap-guangzhou                       [3] ⌄ │  click folds the region
 │ ┌──────────────────────────────────────┐ │
 │ │ ▣ web-1                            ☆›│ │
 │ │   S5.MEDIUM4 · RUNNING               │ │
 │ └──────────────────────────────────────┘ │
 │ ⚠ 1 region failed                        │  failures note, one line
 │   na-ashburn  AuthFailure…               │  per failed region
 │ 3 instances · 21 regions                 │  "Scanning ap-x (4/21)…"
 └──────────────────────────────────────────┘    while it runs
 Regions come from DescribeRegions (cached a day) and are scanned one at
 a time; the last cached result per region shows first; empty regions are
 hidden; filtering hides groups with no match.

 CVM instance   Details: instance ID, name, type, state, region.
                (Mobile lists one region and shows these same fields.)

 CAM Users / CAM Roles   flat list: filter, rows (name · uin/… or
                role/… id), "N of M", favorites, [⟳].
 CAM user / role
   Details            name, ID, path, created
   Attached policies  each a fold; the JSON document loads on first open
                      (CAM has no inline policies)

 EventBridge (CEB)   regional list over the five CEB regions; rows are
                     event buses and rules (Rule · Enabled · description).
 EventBridge item    [⟳]
   Details           bus: name, ID, description, type, created, modified,
                     region; rule: + event bus, state, status
   Event pattern, Target · <id> — JSON blocks

 Billing   (CNY) month to date · estimated, Balance (remaining, red when
           negative), By service, 11 months of history (folds); a service
           drills into By usage and By bucket / instance / resource (folds
           per resource); "Showing the first 2000 bill records." when cut.
```
