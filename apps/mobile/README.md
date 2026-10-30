# Cloud Console — React Native (Expo)

The iOS app rebuilt in React Native + TypeScript. Signing, provider clients, demo
data, caching and the storage operation queue live in `packages/core`, so the
Chrome extension uses the same code. `apps/ios` (SwiftUI) stays as the reference
until this app matches it.

Same hard rules as the Swift app: one access key per connection, sent straight
to the provider. Keys are kept only in the Keychain (`expo-secure-store`,
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Resource kinds that aren't implemented stay
hidden, because the UI only lists `resourceKinds(vendor, "mobile")` and
`availableVendors("mobile")` from `@cloud-console/core/catalog`.

## Setup

```sh
# from the repo root (npm workspaces)
npm install

cd apps/mobile
make start       # expo start (dev server; needs a dev build, not Expo Go, for SecureStore/Face ID config)
make ios         # expo run:ios — prebuilds ios/ and builds into the simulator/device
make typecheck   # tsc --noEmit
make export      # expo export --platform ios → /tmp/cloud-console-mobile-export (Hermes bundle check)
make doctor      # npx expo-doctor
make test-core   # vitest in packages/core
```

The same commands work as `npm run start | ios | typecheck | export:ios | doctor`.

- Expo SDK 58 (React Native 0.88, React 19.3), expo-router, Hermes.
- Metro is set up for the monorepo (`metro.config.js`). It watches the repo root,
  resolves hoisted `node_modules`, and turns on package exports so that
  `@cloud-console/core/<path>` maps to `packages/core/src/<path>.ts`.
- The root `package.json` pins `react`/`react-dom` to 19.3.0 with `overrides`,
  so only one copy of React is installed (expo-doctor flags duplicates).
- TypeScript 7 is used across the repo. Expo's suggested `~6.0` is excluded in
  `expo.install.exclude`.
- `expo prebuild` / `run:ios` write `ios/` and `android/`, which are gitignored.

## Layout

```
app/                     expo-router screens
  _layout.tsx            boot: settings → lock → connections → queue; lock on background
  index.tsx              Home: connection cards + Settings card
  add/                   provider picker, access-key form (test via STS, save to Keychain)
  c/[id]/[kind].tsx      a connection's resource list for one kind
  c/[id]/{bucket,object,destination,ec2,lambda,principal,event,parameter,detail,billing-detail}.tsx
  operations.tsx         Process Queue
  passcode-setup.tsx
src/services/            cloud.ts (demo-aware API layer), keychain, settings, applock, queue, cache, demo
src/screens/             Billing, ResourceList, RegionalList, SettingsCard, LockScreen
src/components/          grouped-list UI kit, Sparkline, passcode pad
```

## Parity checklist vs. the Swift app

Done (code and typechecks only; not yet run on a device):

- [x] Home: a card per connection showing vendor accent, "added" date, service rows and a remove menu; empty state; Settings card
- [x] Add connection: provider picker (only available vendors), key form, paste-to-fill parser, info popover, learn-more link, STS / Tencent STS test before saving
- [x] Keychain: same credential JSON shape and key name (`cloud.credential.<id>`) as the Swift app
- [x] App lock: Face ID toggle, 4-digit passcode (create → confirm → hint), salted SHA-256 hash in Keychain, locks on background, passcode fallback
- [x] Demo mode: preset connections and data from `packages/demo`, all date tokens, separate connection list, Reset demo data. No network, Keychain, cache or writes in demo mode
- [x] Resource cache: 5-minute TTL (1 h for cost drill-downs), stale value shown while refreshing, same cache keys as Swift
- [x] Billing (AWS Cost Explorer, Tencent Billing): month-to-date, balance (Tencent), by service, 12-month history, service drill-down by usage and by resource, 14-day window note
- [x] S3 and COS buckets: list (S3 bucket regions via HEAD), folder browse, stats bar, load more
- [x] Objects: preview (download to cache, then system Quick Look, plus inline text for text files), details, share presigned link (1 h)
- [x] Writes through the queue: delete, batch delete, rename, duplicate, copy to / move to (including to another bucket), upload from Photos / Files with MD5-ETag skip, select mode, batch share (links copied)
- [x] Process Queue: progress, failure message, retry, clear finished; saved to disk and resumed on launch and on return to foreground
- [x] EC2: scans regions one at a time (us-east-1, us-west-1, Canada, then the rest), grouped and foldable by region with counts, failed-regions alert
- [x] EC2 instance: details, status checks, 7 health tiles (CPU, memory, disk via CWAgent SEARCH, network, EBS), refreshed every 60 s, tap-and-drag to read a point
- [x] Lambda: regional list; detail; JSON input saved per function; confirm before run; synchronous invoke; live CloudWatch log tail for that run, capped at the function timeout + 20 s; response
- [x] IAM users/roles and CAM users/roles: list, detail, attached and inline policies, each document loaded when expanded
- [x] EventBridge (AWS, regional: rules, buses, Scheduler schedules) and Tencent CEB (5 regions): list and detail with documents
- [x] Parameter Store: regional list; values fetched on the detail page and never cached; SecureString shown only after tapping Reveal
- [x] Tencent CVM: list and key/value detail

Not yet at parity:

- [ ] **Background transfers.** iOS used a background `URLSession`, so queue requests kept running while the app was suspended. In JS, requests stop when the app is suspended; unfinished items stay `pending` and resume on the next foreground or launch. True background execution needs `expo-background-task` or a native module.
- [ ] **Quick Look in place.** The Swift sheet embedded `QLPreviewController`. This app shows a details page with an "Open Preview" button (`File.preview`, which opens Quick Look full-screen) and inline text for text files.
- [ ] **Swipe actions on rows.** Swift had trailing Delete/Rename swipes plus a context menu. This app has a long-press action sheet with all the same actions, but no swipe.
- [ ] **Rename on Android.** It uses `Alert.prompt`, which only exists on iOS. Android isn't a target yet.
- [ ] **Charts.** Health tiles use a small View-based sparkline instead of Swift Charts. There's no y-axis, same as Swift.
- [ ] **Navigation subtitle.** On iOS 26 the Swift app showed the connection name under "Billing". Here it's used as the back-button title.
- [ ] **Store region.** `make device STORE=cn` / `AppStoreRegion` has no RN equivalent yet. It was a TODO in Swift too.
- [ ] **Screenshot mode.** The `#if SCREENSHOTS` deep-link setup wasn't ported.
- [ ] **Tests on device.** Only `tsc`, `expo export` (Hermes bundle) and `expo-doctor` were run. Nothing was run on a simulator or device.

Unimplemented in both apps (kept out of the UI by the catalog): RDS, CloudWatch
alarms, Tencent SCF/CDB/Monitor alarms, plus Azure, GCP and Alibaba on mobile.
