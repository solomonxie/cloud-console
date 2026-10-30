// Just enough STS to sanity-check a key works, without requiring any
// specific resource permission (unlike e.g. S3 ListBuckets).
import type { AwsKey } from "./sigv4.ts";
import { awsFetch, queryUrl } from "./http.ts";
import { xmlField } from "./xml.ts";

export interface CallerIdentity {
  account?: string;
  arn?: string;
  userId?: string;
}

export async function getCallerIdentity(key: AwsKey): Promise<CallerIdentity> {
  const url = queryUrl("https://sts.amazonaws.com/", { Action: "GetCallerIdentity", Version: "2011-06-15" });
  const { text } = await awsFetch(key, { url, region: "us-east-1", service: "sts" });
  return { account: xmlField(text, "Account"), arn: xmlField(text, "Arn"), userId: xmlField(text, "UserId") };
}

export async function validateKey(key: AwsKey): Promise<void> {
  await getCallerIdentity(key);
}
