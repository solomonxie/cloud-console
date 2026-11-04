// Pasted or loaded credentials JSON → the credentials calls run as. Shared
// by the Chrome accounts and the mobile Add Google Cloud form.
import { credentialsProblem, impersonate, impersonatedEmail, type GoogleCredentials } from "./auth.ts";

// Throws a user-facing message on problems.
export function parseCredentials(json: string): GoogleCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Credentials aren't valid JSON.");
  }
  const problem = credentialsProblem(parsed);
  if (problem) throw new Error(problem);
  return parsed as GoogleCredentials;
}

// Wrapped to impersonate when a service account email is given.
export function accountCredentials(json: string, impersonateEmail?: string): GoogleCredentials {
  const creds = parseCredentials(json);
  return impersonateEmail ? impersonate(creds, impersonateEmail) : creds;
}

export function credentialsLabel(creds: GoogleCredentials): string {
  if (creds.type === "impersonated_service_account") return impersonatedEmail(creds);
  return creds.type === "authorized_user" ? "gcloud user credentials" : creds.client_email;
}

// The project a credential names on its own: a key's project_id, or ADC's
// quota project. Impersonation keeps the source's.
export function defaultProject(creds: GoogleCredentials): string | undefined {
  if (creds.type === "impersonated_service_account") return defaultProject(creds.source_credentials);
  return creds.type === "authorized_user" ? creds.quota_project_id : creds.project_id;
}
