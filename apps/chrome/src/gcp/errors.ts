import { GcpApiError } from "@cloud-console/core/gcp/request";

// Turns an API error into a message that says what to do about it.
export function describeError(err: unknown, what: string): string {
  if (err instanceof GcpApiError) {
    if (err.reason === "SERVICE_DISABLED" || /has not been used|is disabled/.test(err.message)) {
      return `${what}: the API is disabled for this project. ${err.message}`;
    }
    if (err.isPermissionDenied) {
      return `${what}: permission denied — this credential lacks the IAM role for it. ${err.message}`;
    }
    return `${what}: ${err.message}`;
  }
  return `${what}: ${err instanceof Error ? err.message : String(err)}`;
}
