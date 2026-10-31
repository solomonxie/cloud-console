# UI/UX mockups — Chrome Cloud Console

The whole product is one Chrome side panel. Every surface drawn as it is
built today; `../design.md` carries the product decision, `../implementation.md`
the build order.

Glyphs follow the `uiux` skill (`references/notation.md` + `text-figma.md`):
`[[ x ]]` primary · `[ x ]` secondary · `( x )` link button · `[icon]` icon
button · `›` opens · `⟳` working · `←` annotation · `!` destructive ·
`·` disabled · `[brackets]` = `<dialog>`.

## Surface map

A stack, like the mobile app: Home → resource screen → detail screen.
Every pushed screen has the same header (back, title, subtitle, actions);
back pops to the previous screen exactly as it was left.

```
 Chrome toolbar icon ─▶ side panel (the entire UI)
   │
   └ Home      ☁ Cloud Console              [＋] [⬆] [⬇]
       │          ＋ ─▶ [add chooser] ─▶ [connection dialog] | [Google Cloud account]
       │          ⬆ export all · ⬇ import (a JSON file)
       ├ filter box (only with many connections)
       ├ storage card   [S3] Personal · Amazon S3          [✎]
       │   └ my-bucket                                  › ─▶ bucket browser
       └ GCP card       [GCP] Work · Google Cloud          [✎]
           ├ Cloud Storage    › ─▶ buckets of the project ─▶ bucket browser
           ├ VM Instances     › ─▶ instance list ─▶ instance detail
           ├ Instance Groups  › ─▶ group list ─▶ group detail ─▶ instance detail
           └ Secrets          › ─▶ secret list ─▶ secret detail

 bucket browser   [←] my-bucket / Personal          [actions]
   ├ toolbar   [⟳] [☑] [📋]            [New folder] [Upload]
   ├ breadcrumb  bucket › logs › 2026
   ├ filter box (narrows the loaded rows)
   ├ clipboard pill (only while something is cut/copied)
   ├ selection bar (only in select mode)
   ├ status line (only while working, or on an error)
   ├ file list  ..  folders, then files            ─▶ [detail sheet]
   │                                                    └─▶ [share dialog]
   ├ [ Load more… ]
   └ stats      3 folders · 128 files · 1.2 GB · more not loaded

 GCP list screens   project combobox (type to filter, or a project ID)
                    + filter box over the loaded rows

 dialogs: add chooser · connection · GCP account · manage · confirm ·
          prompt · share · detail
```

## Files

| File | Covers |
|---|---|
| `panel.md` | Home, screen header, stack, bucket browser toolbar/list/stats, GCP screens, empty states |
| `objects.md` | detail sheet, preview/edit, share, upload, clipboard, bulk |
| `connections.md` | the + chooser, add/edit connection per provider, manage, import/export |
