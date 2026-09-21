# Cloud Console — UI/UX

Text mockups for the direct-connect console design (no backend, no IaC
— see the repo `README.md`). Glyph alphabet: the `uiux` skill's
`references/notation.md`. Fixed width ~60 cols (mobile).

```
      Launch
        │
        ▼
   ┌────────────────────────────────────┐
   │             Home (list)             │
   └────────────────────────────────────┘
     │                              │
     ▼                              ▼
 Connection detail              + Add connection
     │                              │
     ▼                              ▼
 Resource kind list            Pick provider ──▶ paste access
 (S3 ✓, EC2/Lambda/…           key ──▶ test & add
  "coming soon")
     │
     ▼
 S3: bucket list (region tag) ──▶ objects/folders ──▶ drill in
```

## Screens

| File | Covers | Status |
|---|---|---|
| `components.md` | connection row, resource row, credential field | drawn |
| Home | connection list, empty state, add sheet | implemented |
| Add connection | provider picker, single access-key form | implemented |
| Connection detail | resource kind picker (S3 live, rest "coming soon") | implemented |
| Buckets | bucket list w/ region, folder/object browser | implemented |

## Cross-screen flow — first run

```
Home (empty) ──▶ tap + ──▶ pick provider ──▶ paste access key
                                                    │
                                     test (STS GetCallerIdentity)
                                                    │
                                          saved to Keychain, connection
                                          appears on Home
                                                    │
                                                    ▼
                              tap connection ──▶ resource kind list
                                                    │
                                     tap S3 (only live one so far)
                                                    │
                                          bucket list, region-tagged
                                                    │
                                          drill into folders/objects
```

Everything else (EC2, Lambda, RDS, other providers) shows as a disabled
row with "Coming soon" until it's actually implemented — see
`CloudVendor.resourceKinds` / `ResourceKind.isImplemented`.
