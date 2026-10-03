# Creating an access key for Cloud Console

One key per connection. The app only does what the key's permissions allow, so give it the least you need. Use a dedicated user, never the root/main account's key.

## AWS

1. [IAM console](https://console.aws.amazon.com/iam/) → **Users** → **Create user** (no console access).
2. Attach permissions:
   - Look only: AWS managed policy [`ReadOnlyAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/ReadOnlyAccess.html).
   - Or a custom policy with just what you use (below).
3. The user → **Security credentials** → **Create access key** → *Application running outside AWS*.
4. Copy the access key ID and secret (shown once) → app → **+** → AWS → paste.

Actions the app calls, by screen:

| Screen | Actions |
|---|---|
| Billing | `ce:GetCostAndUsage` |
| S3 (browse, preview, share) | `s3:ListAllMyBuckets`, `s3:ListBucket`, `s3:GetObject` |
| S3 (upload, copy, move, rename, delete) | `s3:PutObject`, `s3:DeleteObject` |
| IAM users / roles | `iam:ListUsers`, `iam:ListRoles`, `iam:ListAttachedUserPolicies`, `iam:ListUserPolicies`, `iam:GetUserPolicy`, `iam:ListAttachedRolePolicies`, `iam:ListRolePolicies`, `iam:GetRolePolicy`, `iam:GetPolicy`, `iam:GetPolicyVersion` |
| EC2 | `ec2:DescribeRegions`, `ec2:DescribeInstances`, `ec2:DescribeInstanceStatus`, `cloudwatch:GetMetricData` |
| Lambda (list / run + logs) | `lambda:ListFunctions` / `lambda:InvokeFunction`, `logs:FilterLogEvents` |

The key is checked on add with STS `GetCallerIdentity`, which needs no permission.

Official docs: [Manage IAM access keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html).

## Tencent Cloud

1. [CAM console](https://console.tencentcloud.com/cam) → **Users** → **Create user** → **Custom** → sub-user with **programmatic access**.
2. Attach policies:
   - Look only: preset `ReadOnlyAccess`. Billing also needs a billing/finance read policy.
   - COS upload, copy, move, rename, delete: add a COS write policy (e.g. `QcloudCOSFullAccess`, or a custom one scoped to your buckets).
3. Copy the SecretId and SecretKey (the key is shown once; more under the user → **API keys**) → app → **+** → Tencent Cloud → paste.

The key is checked on add with STS `GetCallerIdentity`.

Official docs: [Cloud Access Management](https://www.tencentcloud.com/document/product/598).
