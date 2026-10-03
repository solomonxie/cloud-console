# Cloud Console

## Hard rules

- **One access key per connection, direct to the provider.** No backend,
  no IaC, no privilege escalation — the app only ever does what that
  key's own permissions allow.
- **Credentials only live in Keychain, and only leave the device for
  the provider's own API.** Never logged, never sent anywhere else.
- **Provider/resource support is incremental.** A resource kind or
  vendor stays out of the UI until it's implemented — no "coming soon"
  rows (App Review 2.1/2.2). Keep it in the model with
  `isImplemented = false`; `resourceKinds` and `CloudVendor.available`
  filter it out. Build order: S3 → EC2 → Lambda → RDS → more.
