# TestFlight external testing

App Store Connect → TestFlight → External Testing → **+** group → add the build. First build of a version goes through Beta App Review (~1 day).

## Test Information

Beta App Description (≤4000):

```
Cloud Consoles puts your own AWS and Tencent Cloud accounts on your iPhone: billing, buckets, users and roles, instances and functions, all signed on the device with your own access key. No account of ours, no server in between; keys stay in the Keychain.

You don't need a cloud account to look around: Home → scroll to the Settings card at the bottom → Demo mode. It shows two sample connections (AWS "Northwind Production", Tencent "Lanting Studio (Shanghai)") with no network calls; write actions are simulated.

What's in this beta:
• AWS: Cost Explorer billing; S3 browse, preview, share, upload, copy, move, rename, delete; IAM users, roles and policies; EC2 across regions with status checks and metrics; Lambda invoke with live logs
• Tencent Cloud: billing and balance, COS, CAM, CVM
• Face ID / passcode lock

Nothing leaves your phone except the API calls you make to your own cloud account.
```

Feedback Email: `you@example.com`

## Contact Information

| Field | Value |
|---|---|
| First Name | TODO |
| Last Name | TODO |
| Phone number | TODO — yours, with country code (`+1 …`) |
| Email | `you@example.com` |

## Sign-In Information

Sign-in required: **off** (no account in the app). Leave User Name / Password blank.

Review Notes (Beta App Review Information):

```
No login of our own. Real use needs the user's own cloud access key, which a reviewer won't have, so please use Demo mode: Home → scroll to the Settings card at the bottom → Demo mode. Two sample connections appear; every screen works offline and write actions are simulated. Not offered on the China mainland storefront.
```

## Per build: What to Test

```
Turn on Demo mode (Home → Settings card at the bottom) and open every service on both sample connections: billing, buckets, IAM/CAM, instances, Lambda. If you have your own AWS or Tencent access key, add a real connection and try billing and bucket browsing. Report anything slow, wrong or confusing with a screenshot via TestFlight.
```
