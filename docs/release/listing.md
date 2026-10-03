# Publishing Cloud Console — step by step

Every field below is ready to paste. `TODO` = only you can supply it.
App Store Connect paths start at **Apps → Cloud Console → Distribution →**.

| | |
|---|---|
| Bundle ID | `com.example.cloudconsole` |
| SKU | `cloudconsole-ios` |
| Version | `1.0` (`MARKETING_VERSION` in `project.yml`) |
| Build | timestamp, set by `make release` |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) — no iPad screenshots needed |
| Min iOS | 17.0 |
| Privacy Policy URL | `https://github.com/solomonxie/cloud-console/blob/master/docs/release/privacy-policy.md` |
| Support URL | `https://github.com/solomonxie/cloud-console/issues` |

---

## 0. Before 1.0 — nothing unfinished in sight

Guideline 2.1 (completeness) and 2.2 (no placeholder or "coming soon" content). Already handled in code:

- Unimplemented resource kinds and vendors are hidden everywhere (`resourceKinds`, `CloudVendor.available` in `CloudConsole/Models/CloudVendor.swift`). Add connection lists AWS and Tencent Cloud only.
- "Learn how to create →" opens [`docs/access-keys.md`](../access-keys.md) — **push it to `master` before submitting**, or the link 404s.
- AWS and Tencent Cloud keys are both tested before saving (STS `GetCallerIdentity`).
- iPhone only; SwiftUI `App` lifecycle with a scene manifest, so it launches on iPad (App Review runs it there) and on iOS 27.

- [x] Demo mode shows no greyed or "Coming soon" rows (checked in the 2026-10-02 screenshots).

## 1. Apple Developer account

- [ ] developer.apple.com → Account → membership **active** (paid, Individual is fine).
- [ ] App Store Connect → **Business** (Agreements, Tax, and Banking) → no pending agreement banner. Free app: no Paid Apps agreement or banking needed.

## 2. Xcode and tools

- [ ] Xcode → Settings → **Accounts** → signed in with the developer Apple ID; the team shows under it.
- [ ] `cp Config/Local.xcconfig.example Config/Local.xcconfig`, set your Team ID (developer.apple.com → Membership). Gitignored — never commit it; the repo is public.
- [ ] `brew install xcodegen` if `xcodegen` isn't on the PATH. The `.xcodeproj` is generated from `project.yml` and gitignored.

## 3. Bundle ID

Created by automatic signing on the first device build. Verify at developer.apple.com →
Certificates, Identifiers & Profiles → Identifiers → `com.example.cloudconsole`.
No capabilities needed (no iCloud, no push, no App Groups). Face ID needs only `NSFaceIDUsageDescription`, already set.

## 4. Run on the iPhone

- [ ] `make device` → Release build on the connected iPhone (`STORE=us`).
- [ ] Smoke test, real account (a read-only IAM key is enough for most of it):
  - Add connection → AWS → paste key → Test & add succeeds; a wrong secret shows an error. Same for Tencent Cloud.
  - "Learn how to create →" opens the help page (after it's pushed).
  - Billing: month-to-date and monthly history.
  - S3: open a bucket, a folder, preview an object, share it; upload a photo, rename/move/delete a test file, check Process Queue.
  - IAM users and roles → a policy document.
  - EC2: regions fill in one by one; open an instance → status checks and metrics.
  - Lambda: run a test function with `{}` → response and live logs.
  - Settings: Face ID on, passcode on; background and return → lock screen.
- [ ] Settings → **Demo mode** on: two sample connections (AWS "Northwind Production", Tencent Cloud "Lanting Studio (Shanghai)"); every screen above works with no network. Reset demo data. Off again: your real connections are back.

## 5. Create the app in App Store Connect

**Apps → + → New App**

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | `Cloud Console` |
| Primary Language | English (U.S.) |
| Bundle ID | `com.example.cloudconsole` (dropdown) |
| SKU | `cloudconsole-ios` |
| User Access | Full Access |

If the name is taken, the runner-up list is in [App Store Connect pages](#app-store-connect-pages).

## 6. Listing content

Fill the pages in [App Store Connect pages](#app-store-connect-pages) below. Screenshots: see [Screenshots](#screenshots).

## 7. Archive and upload

```
make release
```

Runs `make check`, then generates the project, archives Release, signs for the App Store and
uploads (`scripts/release-ios.sh`) — no Xcode Organizer. `make release BUILD=202610021830`
pins the build number; left off, it is a timestamp. `STORE` defaults to `us`; keep it for 1.0.

Upload authenticates as the Apple ID signed into Xcode → Settings → Accounts. If it asks
for credentials in a terminal, add an App Store Connect API key instead: download the
`.p8`, then append `-authenticationKeyPath <abs path> -authenticationKeyID <id>
-authenticationKeyIssuerID <issuer>` to the `-exportArchive` call in `scripts/release-ios.sh`.
Processing in App Store Connect: 15–60 min, then an email "build has completed processing".

Fallback, Xcode GUI: `xcodegen generate && open CloudConsole.xcodeproj` → destination **Any iOS Device (arm64)** → Product → **Archive** → Organizer → **Distribute App** → App Store Connect → Upload.

## 8. TestFlight

- [ ] App Store Connect → **TestFlight** → the build shows no "Missing Compliance" (see [Export compliance](#export-compliance)).
- [ ] Internal Testing → **+** group `Me` → add your Apple ID → install via the TestFlight app on the iPhone.
- [ ] Same smoke test as step 4, on the TestFlight build (this is the exact binary Apple reviews). Demo mode especially — it is all the reviewer will use.

## 9. Submit

- [ ] `iOS App → 1.0 Prepare for Submission` → **Build** → **+** → pick the build.
- [ ] Every page in [App Store Connect pages](#app-store-connect-pages) filled; App Privacy published.
- [ ] **Add for Review** → **Submit for Review**.

## 10. App Review

- Typical: 24–48 h. Status: Waiting for Review → In Review → Pending Developer Release.
- Rejection → **Resolution Center**: reply there, or fix and re-run `make release` (the build number is a fresh timestamp), attach the new build, resubmit. `MARKETING_VERSION` does not need bumping for a rejected version.
- Likely questions, all answered in the review notes:
  - No test account: the reviewer has no AWS account. Demo mode in Settings shows every screen with preset data.
  - Unfinished features: none shown; see step 0.
  - What the app can change in a real account: only what the user's own key allows; destructive actions are confirmed first.

### Guideline 2.1 "Information Needed" (new developer accounts)

Apple wants a screen recording plus answers. The answers are the App Review Notes further down — paste them into the reply **and** into App Review → Notes.

Record the build Apple will review. If it's a new build, upload it first (`make release`), pick it under **Build** on the `1.0` page, and install it from TestFlight.

Recording (on the iPhone, current iOS):
1. iPhone Settings → Control Center → add **Screen Recording**. Turn on Do Not Disturb.
2. In the app, scroll to the Settings card → **Demo mode** on → **Reset demo data** (keeps your real accounts and keys off screen). Swipe the app away.
3. Start recording, then launch the app from the Home Screen.
4. ~2 minutes:
   1. Home: the two demo connections (AWS, Tencent Cloud).
   2. AWS → Billing: month-to-date, monthly history.
   3. AWS → S3 Buckets → a bucket → a folder → an object → preview.
   4. AWS → IAM Users → a user → an attached policy document.
   5. AWS → EC2 Instances → regions → an instance → status checks and metrics.
   6. AWS → Lambda Functions → a function → Run with `{}` → confirm → response.
   7. Tencent Cloud → COS Buckets → a bucket; CVM Instances.
   8. **+** → Add connection → AWS: the access-key form and its Keychain footer (don't submit).
   9. Settings card: Face ID and Passcode toggles, Process Queue, Demo mode.
5. Stop. Photos → trim → share the video.

Reply: `App Review` in App Store Connect → the message → **Reply**, attach the video (or an unlisted link if it's too large), paste:

```
Hello, thank you for the review. Answers below, and the same text is now in the App Review Information notes.

1. Screen recording attached, captured on an iPhone running the latest iOS, starting from launch, in the app's built-in Demo mode. The app has no account registration or login of its own (so no account deletion flow), no user-generated content, and no paid content.

[paste the App Review Notes block from PURPOSE AND AUDIENCE to the end]
```

## 11. Release

- [ ] Status **Pending Developer Release** → `1.0` page → **Release This Version**. Live in the store within ~24 h.
- [ ] `git tag v1.0 && git push --tags`.

---

## Screenshots

Apple requires one set: **iPhone 6.9" Display**, exactly `1320 × 2868`. App Store Connect scales
it down for every smaller phone. The 6.5" slot (`1284 × 2778`) is optional and generated anyway.

**Ready** — captured 2026-10-02 on the iOS Simulator (iPhone 18 Pro, iOS 27) in Demo mode:
fictional sample accounts only, no real account IDs, bucket names, IPs or bills.
Files: `docs/release/screenshots/6.9/*.jpg` (and `6.5`), JPEG, no alpha.
Upload in filename order (the first two are what people actually see):

1. `01-home` — Home: AWS and Tencent Cloud connection cards
2. `02-billing` — AWS Billing: month-to-date by service
3. `03-s3` — S3 bucket browser: folders, objects, sizes, storage classes
4. `04-ec2` — EC2 instances grouped by region
5. `05-ec2-health` — instance health: status checks, CloudWatch metrics
6. `06-lambda` — Lambda functions grouped by region
7. `07-lambda-run` — a Lambda run: live logs and response
8. `08-iam` — IAM user with an attached policy document
9. `09-add` — Add connection → AWS form ("Stored only in this device's Keychain")
10. `10-settings` — Settings card: Face ID, Passcode, Process Queue, Demo mode

Recapture: a `SCREENSHOTS` build (never in `make release`) takes `-screen <name>`, turns on
Demo mode, resets demo data and bypasses the app lock. Names: `home billing s3 ec2 ec2-health
lambda lambda-run iam add settings` (`CloudConsole/Screenshots.swift`).

```
U=<simulator udid>
xcodegen generate
xcodebuild -scheme CloudConsole -configuration Debug -destination "id=$U" -derivedDataPath build/shots \
  SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) SCREENSHOTS' build
xcrun simctl install $U build/shots/Build/Products/Debug-iphonesimulator/CloudConsole.app
xcrun simctl status_bar $U override --time 9:41 --dataNetwork wifi --wifiBars 3 --cellularBars 4 --batteryState charged --batteryLevel 100
xcrun simctl launch --terminate-running-process $U com.example.cloudconsole -screen billing
xcrun simctl io $U screenshot ~/Desktop/shots/02-billing.png   # ~10 s after launch; repeat per screen
make screenshots SHOTS=~/Desktop/shots
```

Face ID shows "on" only if the simulator has Face ID enrolled (Features → Face ID → Enrolled).

App Preview video: skip for 1.0.

---

## App Store Connect pages

### `iOS App → 1.0 Prepare for Submission`

| Field | Value |
|---|---|
| Previews and Screenshots | [Screenshots](#screenshots) |
| Promotional Text | below |
| Description | below |
| Keywords | below |
| Support URL | `https://github.com/solomonxie/cloud-console/issues` |
| Marketing URL | leave blank |
| Version | `1.0` |
| Copyright | `2026 solomonxie` |
| Routing App Coverage File | leave blank |
| Build | the uploaded build (step 9) |
| App Review → Sign-In Required | **Off** — no login of our own; Demo mode covers the review |
| App Review → Contact First / Last Name | TODO |
| App Review → Phone | TODO (with country code, e.g. `+1 …`) |
| App Review → Email | TODO |
| App Review → Notes | below |
| App Review → Attachment | none (the screen recording, if asked, goes in the reply) |
| Version Release | **Manually release this version** |

Promotional Text (154/170):

```
Browse buckets, check servers, run functions and watch the bill — with your own access key, straight to the provider. No backend, no account, no tracking.
```

Description:

```
Cloud Console is a native iPhone console for the cloud accounts you already have. Add an access key, and browse and manage resources with exactly the permissions that key has — nothing more.

No backend. No sign-up. Requests go straight from your iPhone to the provider.

AMAZON WEB SERVICES
• Billing: month-to-date spend and monthly history by service
• S3: browse buckets and folders, preview and share objects, upload photos and files, copy, move, rename and delete — with a background transfer queue
• IAM: users and roles, with their attached and inline policy documents
• EC2: instances across every enabled region, grouped by region, with status checks and CloudWatch metrics
• Lambda: functions across regions; run one with a JSON input and watch its logs stream live

TENCENT CLOUD
• Billing summary and balance
• COS buckets and objects
• CAM users and roles with their policies
• CVM instances

ONE KEY PER CONNECTION
Each connection is one access key you create in your provider's console. The app never combines keys, never escalates privileges, and only ever does what that key allows — give it read-only access if you just want to look. Add several accounts and tell them apart with labels.

PRIVATE BY DESIGN
• Keys are stored in the iOS Keychain and only ever sent to the provider's own API, in requests signed on the device
• No analytics, no ads, no tracking, no third-party SDKs
• Lock the app with Face ID or a passcode

DEMO MODE
Turn on Demo mode in Settings to explore every screen with sample accounts. Nothing is sent anywhere.

Cloud Console is an independent app, not affiliated with or endorsed by Amazon Web Services or Tencent Cloud.
```

Keywords (97/100 — "cloud" and "console" are omitted, the name already indexes them; no provider brand names, guideline 2.3.7):

```
s3,ec2,lambda,iam,bucket,billing,cost,server,devops,sysadmin,admin,storage,instance,ops,sre,files
```

App Review Notes (also the Guideline 2.1 answers):

```
No login of our own. The app needs the user's own cloud access key for real use, which a reviewer won't have — so please use Demo mode:

Home → scroll to the Settings card at the bottom → turn on "Demo mode". Two sample connections appear (an AWS account and a Tencent Cloud account) and every screen works with preset data, with no network and no account needed. "Reset demo data" restores the preset. Turning Demo mode off returns to the real (empty) connection list; nothing is mixed.

PURPOSE AND AUDIENCE
Cloud Console is a native mobile console for developers, sysadmins and small teams who run their own cloud accounts. It lets them check costs, browse storage, look at servers and permissions, and run a serverless function from their iPhone, without opening a desktop browser. It replaces the provider's web console for quick, on-the-go tasks.

HOW TO USE THE MAIN FEATURES (in Demo mode)
- Home: one card per connection; each row is a service.
- Billing: month-to-date spend and monthly history.
- S3 Buckets / COS Buckets: browse buckets and folders, preview or share an object, upload from Photos or Files; copy, move, rename and delete go through a confirmed Process Queue (Settings card). In Demo mode, writes are not sent anywhere.
- IAM Users / IAM Roles, CAM Users / CAM Roles: users and roles, with their policy documents.
- EC2 Instances / CVM Instances: instances grouped by region; an EC2 instance shows status checks and metrics.
- Lambda Functions: open a function, enter JSON, tap Run and confirm; the response is shown.
- "+" (top right): Add connection → AWS or Tencent Cloud → paste an access key. The key is validated with the provider's STS GetCallerIdentity, then stored in the Keychain. "Learn how to create" opens a help page on creating a least-privilege key.
- Settings card: Face ID and passcode app lock, Process Queue, Demo mode.

REAL USE
The user creates an access key in their own AWS (IAM) or Tencent Cloud (CAM) account and pastes it in. The app can only do what that key's permissions allow; it never creates keys, users or permissions.

EXTERNAL SERVICES
- Amazon Web Services public APIs (sts, s3, iam, ce, ec2, lambda, logs, monitoring on *.amazonaws.com), only for connections the user adds, signed on the device with the user's own key (AWS Signature V4).
- Tencent Cloud public APIs (*.tencentcloudapi.com, *.myqcloud.com), same conditions.
- Safari opens a help page on github.com from "Learn how to create".
No analytics, advertising, crash reporting, authentication or payment services. We run no server and receive no user data.

REGIONAL DIFFERENCES
None. The app behaves the same everywhere and is English only. It is not offered on the China mainland storefront in this version.

REGULATION
Cloud Console is a client for the user's own cloud accounts. It does not host content, move money, or provide cloud services itself; billing figures are read from the provider. It is not affiliated with Amazon or Tencent. No third-party protected material is included.

Keys are stored in the iOS Keychain; settings and cached listings stay on the device.
```

What's New: not shown for a first version. From 1.1 on, write it here.

### `General → App Information`

| Field | Value |
|---|---|
| Name | `Cloud Console` (13/30) |
| Subtitle | `Buckets, servers & billing` (26/30) |
| Category — Primary | Developer Tools |
| Category — Secondary | Utilities |
| Content Rights | **No**, it does not contain, show, or access third-party content |
| Age Rating | **Edit** → answers below → result **4+** |
| License Agreement | Apple standard EULA (default) |
| Privacy Policy URL | `https://github.com/solomonxie/cloud-console/blob/master/docs/release/privacy-policy.md` |

If `Cloud Console` is taken, in order of preference:
`Cloud Console: Pocket Admin` (27), `Pocket Cloud Console` (20), `Cloud Console: Ops on iPhone` (28).
Don't put "AWS", another app's name, or price wording ("free", "no ads", "no subscription") in the name, subtitle, promotional text or keywords — guideline 2.3.7 / 5.2.1. The description may say it.

Content Rights: the app shows the user's own cloud data under their own key, not licensed
third-party content — answer No.

Age rating questionnaire — every answer:

| Section | Answer |
|---|---|
| Parental controls / age assurance | No |
| Unrestricted web access | **No** — no in-app browser; the one help link opens Safari |
| User-generated content | No — nothing is shared or published between users |
| Messaging and chat | No |
| Advertising | No |
| Violence, sexual content, profanity, horror, mature themes | None |
| Alcohol, tobacco, drugs | None |
| Medical or treatment information / health & wellness | None |
| Gambling, simulated gambling, contests, loot boxes | None / No |
| Made for Kids | No |

Regional (Korea, China Mainland, Vietnam) — leave unset.
**Digital Services Act** trader status: **Not a trader** (free, no monetization) — if App Store Connect blocks EU availability without it, answer it in Business → Compliance.

### `App Store → Trust & Safety → App Privacy`

| Field | Value |
|---|---|
| Privacy Policy URL | same as above |
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** |

Then **Publish**. The label shows "Data Not Collected".

True only while there is no analytics or crash SDK — re-check before each submission:

```
grep -rniE "analytics|firebase|sentry|amplitude|mixpanel|posthog|bugsnag|crashlytics" CloudConsole project.yml
```

Data leaves the device only as requests the user triggers, to AWS or Tencent Cloud, under
the user's own key and account — not an SDK, and you never receive any of it, so none of it
is "collected" in Apple's sense. `CloudConsole/PrivacyInfo.xcprivacy` declares no tracking,
no collected data, and the two required-reason APIs used (UserDefaults `CA92.1`, file
timestamps `C617.1` for the resource cache).

### `App Store → Trust & Safety → App Accessibility`

Skip for 1.0 rather than over-claim.

### `App Store → Monetization → Pricing and Availability`

| Field | Value |
|---|---|
| Base Country or Region | United States (USD) |
| Price | **Free** ($0.00) |
| Availability | All countries or regions **except China mainland** |
| Tax Category | App Store software (default) |
| iPhone and iPad Apps on Apple Silicon Macs | **Off** for 1.0 (untested on Mac) |
| Apple Vision Pro | Off |

China mainland stays off for 1.0: a China listing needs an ICP filing, and the add-connection
list offers AWS. `make release STORE=cn` already stamps the region into
`Info.plist`, but nothing reads it yet (`storeRegion()` TODO in `CloudConsole/Services/DemoCloud.swift`).
Gate vendors on it before shipping a `cn` build.

### Not needed for 1.0

In-App Purchases, Subscriptions, In-App Events, Custom Product Pages, Product Page Optimization, Promo Codes, Game Center, Featuring Nominations, Ratings and Reviews, History.

### 简体中文 localization

Skip for 1.0: the app has no Chinese UI (no `.lproj` / `.xcstrings`), and China mainland is off.

---

## Export compliance

No page for it in App Store Connect — nothing to fill in. `ITSAppUsesNonExemptEncryption = false`
in `Info.plist` (set in `project.yml`) answers it at upload. The app uses only HTTPS/TLS, the
Keychain, and CryptoKit hashing/HMAC-SHA256 for request signing (AWS SigV4, Tencent TC3/COS)
and the passcode hash — all exempt.
Verify: TestFlight → the build is **not** marked "Missing Compliance".
Only if it is: **Manage** → **None of the algorithms mentioned above**.
