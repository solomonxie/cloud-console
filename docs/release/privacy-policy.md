# Privacy Policy — Cloud Console

_Last updated: 2026-10-02_

Cloud Console does not collect, transmit, or store your personal data on any server we control. We operate no server.

## What the app stores, on your device
- **Access keys** — each connection's key (e.g. AWS access key ID and secret, Tencent Cloud SecretId and SecretKey) is stored in the iOS Keychain on this device. It is not synced to iCloud Keychain.
- **Connection list** — the label and provider of each connection, in the app's local settings.
- **App lock** — whether Face ID and the passcode are on, and an optional passcode hint. The passcode itself is stored only as a hash, in the Keychain.
- **Cached listings** — recent resource lists (buckets, users, instances, billing totals) are cached in the app's cache folder so screens open instantly. iOS may clear them at any time.
- **Transfer queue** — pending uploads, copies, moves and deletes, so they can finish in the background.
- **Last Lambda input** — the JSON you last ran a function with, so you can run it again.

## What leaves your device
Only requests you trigger, sent directly from the device over HTTPS to the cloud provider of that connection (Amazon Web Services or Tencent Cloud), signed with your own key, under your own account with them. This includes a one-time identity check when you add a key, and files you choose to upload, and objects you open, download or share. Their privacy policies govern that data. Your keys are never sent anywhere else, never logged, and never sent to us.

Demo mode (Settings) uses sample data bundled in the app and sends nothing to any provider.

## Face ID
Optional app lock uses Apple's LocalAuthentication. The app never sees your biometric data; iOS only tells it whether unlocking succeeded.

## Photos and files
Uploading uses the system photo and file pickers. The app only receives the items you pick, and only to upload them to the bucket you are in.

## Analytics and advertising
None. No analytics SDK, no crash reporting, no advertising identifiers, no tracking across apps or websites.

## Children
The app is not directed at children and collects no data from anyone.

## Deleting your data
Remove a connection to delete its key from the Keychain. Deleting the app removes its settings, cache and queue; iOS can keep Keychain items after an app is deleted, so remove your connections first to be sure the keys are gone. Data in your cloud accounts stays yours to manage with the provider.

## Changes
Material changes to this policy will be published here with a new date.

## Contact
Questions or requests: https://github.com/solomonxie/cloud-console/issues
