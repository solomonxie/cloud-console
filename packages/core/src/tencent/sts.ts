// GetCallerIdentity — sanity-checks a key without any resource permission.
import { tencentRequest, TencentApiError } from "./api.ts";
import type { TencentKey } from "./tc3.ts";

export async function validateKey(key: TencentKey): Promise<void> {
  try {
    await tencentRequest(key, { host: "sts.tencentcloudapi.com", service: "sts", action: "GetCallerIdentity", version: "2018-08-13", region: "ap-guangzhou" });
  } catch (error) {
    // Signature accepted; the key just isn't allowed this call.
    if (error instanceof TencentApiError && error.code.startsWith("UnauthorizedOperation")) return;
    throw error;
  }
}
