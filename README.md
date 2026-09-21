# Cloud Console

> 🚧 Work in progress — skeleton only, not yet functional.

A mobile console for your cloud infrastructure: browse resources across
AWS, Azure and Google Cloud, look inside storage buckets, and draft
Terraform changes with AI assistance — all from an iPhone, without needing
a laptop open.

## Features

- **Resources** — browse EC2 instances, Lambda functions, databases and
  more, per cloud provider
- **Buckets** — object storage browser (S3-style)
- **Terraform** — describe a change in plain language, get an AI-drafted
  diff, review it, then apply
- **Git** — connect GitHub repos and manage the access token used to
  commit Terraform changes
- **Settings** — AWS credentials, stored in the Keychain

## Backend architecture (planned)

The app never runs `terraform` or `git` on-device. Instead it calls an AWS
Lambda (via API Gateway) that runs `terraform plan`/`apply` and pushes
commits through the GitHub API. This repo is just the client; a separate
backend repo will follow once the client shape settles.

## Related

[cloud-bucket-viewer](https://github.com/solomonxie/cloud-bucket-viewer) is
a sibling project (a Chrome extension) that already does bucket browsing
for S3/Azure/GCS/Tencent/Alibaba, with its own request-signing
implementation. This app's Buckets tab is expected to follow similar
per-provider signing design, implemented natively in Swift rather than
shared code.

## Setup

Requires [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```
xcodegen generate && open CloudConsole.xcodeproj
```
