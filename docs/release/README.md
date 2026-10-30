# App Store Release

Bundle ID `com.example.cloudconsole` (yours: `APP_BUNDLE_ID` in `apps/ios/Config/Local.xcconfig`) · iOS 17.0+ · iPhone only, portrait.

- [`listing.md`](listing.md) — step-by-step plan and every App Store Connect field, ready to paste
- [`privacy-policy.md`](privacy-policy.md) — the policy; its GitHub URL is the Privacy Policy URL
- `screenshots/` — upload-ready, 10 shots captured 2026-10-02 (Simulator, Demo mode, no real account data).
  Upload order and recapture steps: [`listing.md`](listing.md#screenshots).

Before the first build: `cd apps/ios && cp Config/Local.xcconfig.example Config/Local.xcconfig` and put your
Apple Developer Team ID in it. It is gitignored — an account identifier does not belong in a
public repo. `apps/ios/Config/Signing.xcconfig` (tracked) includes it.

Upload a build: `make release` — generates the project, builds, archives, signs, uploads.
Nothing in Xcode. Build number is a timestamp unless you pass `BUILD=`. `STORE` (default `us`)
is stamped into `Info.plist` as `AppStoreRegion`. `make help` lists the rest.

Versioning: `MARKETING_VERSION` in `apps/ios/project.yml` is the user-visible version; bump it per
release. `CURRENT_PROJECT_VERSION` is set per upload by the script and never committed.

App icon: `make icon` renders light, dark and tinted PNGs from `apps/ios/scripts/make-icon.swift`.
