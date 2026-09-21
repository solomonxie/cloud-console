# Cloud Console

> 🚧 Work in progress. S3 browsing works; everything else is scaffolded.

A native mobile console for your cloud accounts. Connect with an access
key, browse and manage resources with whatever permissions that key
has — no backend server, no IaC, nothing of ours in between.

## How it works

- **One access key per connection.** Paste in an access key when you
  add a cloud account; that's the only credential involved. The app
  never combines keys, never proxies through a server, never does
  anything the key's own permissions don't already allow.
- **Direct to the provider's API**, signed natively on-device (AWS
  SigV4 for AWS — see `Services/AWSSigV4Signer.swift`). No SDK
  dependency, no third-party service sees your traffic or your key.
- **Keychain only.** Keys never leave the device except in signed
  requests to the provider's own endpoints.

## Providers & resources

Built incrementally, one resource kind at a time, as needed:

| Provider | S3/Buckets | EC2 | Lambda | RDS |
|---|---|---|---|---|
| AWS | ✅ | backlog | backlog | backlog |
| Azure, GCP, Tencent, Alibaba | — | — | — | — |

S3 is the only implemented resource for now — the rest are backlog,
picked up one at a time when actually needed, not on a schedule.

Adding a connection for a provider/resource that isn't implemented yet
just shows "coming soon" — the credential is still saved so there's
nothing to redo once it lands.

## Setup

Requires [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```
xcodegen generate && open CloudConsole.xcodeproj
```
