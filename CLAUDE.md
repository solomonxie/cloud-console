# Cloud Console

## Hard rules

- **One access key per connection, direct to the provider.** No backend,
  no IaC, no privilege escalation — the app only ever does what that
  key's own permissions allow.
- **Credentials only live in Keychain, and only leave the device for
  the provider's own API.** Never logged, never sent anywhere else.
- **Provider/resource support is incremental.** Don't scaffold empty
  screens for a resource kind before it's actually implemented — list
  it as "coming soon" in the resource picker instead. Build order:
  S3 → EC2 → Lambda → RDS → more, one at a time, as needed.
