# Cloud Console

Monorepo (npm workspaces): `apps/mobile` (React Native/Expo, replacing the
Swift `apps/ios`), `apps/chrome` (Chrome Cloud Console extension),
`packages/core` (shared TS — signing, API clients, catalog; must run in
Chrome and Hermes: no `crypto.subtle`/`DOMParser`), `packages/demo`
(demo JSON).

## Hard rules

- **One access key per connection, direct to the provider.** No backend,
  no IaC, no privilege escalation — the app only ever does what that
  key's own permissions allow.
- **Credentials only live in Keychain (mobile) or `chrome.storage.local` (extension), and only leave the device for
  the provider's own API.** Never logged, never sent anywhere else.
- **Provider/resource support is incremental.** A resource kind or
  vendor stays out of the UI until it's implemented — no "coming soon"
  rows (App Review 2.1/2.2). Keep it in `packages/core/src/catalog.ts`
  with `isImplemented: false`; `resourceKinds()` and `availableVendors()`
  filter it out, per platform. Build order: S3 → EC2 → Lambda → RDS → more.
- **No Tencent in Chrome this version** beyond COS storage.
