// Shared POST-JSON request helper for Tencent's API 3.0 services. Tencent
// returns HTTP 200 even for API errors, so the body is checked for
// `Response.Error` too.
import { tc3Headers, type TencentKey } from "./tc3.ts";

export class TencentApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(code ? `${code}: ${message}` : message);
    this.name = "TencentApiError";
    this.code = code;
  }
}

export function parseTencentError(body: string): TencentApiError {
  try {
    const envelope = JSON.parse(body) as { Response?: { Error?: { Code: string; Message: string } } };
    const err = envelope.Response?.Error;
    if (err) return new TencentApiError(err.Code, err.Message);
  } catch {
    // fall through
  }
  return new TencentApiError("", body || "Request failed");
}

export interface TencentCall {
  host: string;
  service: string;
  action: string;
  version: string;
  region?: string;
  payload?: Record<string, unknown>;
}

/** Returns `Response` (the envelope's body). */
export async function tencentRequest<T = Record<string, unknown>>(key: TencentKey, call: TencentCall): Promise<T> {
  const body = JSON.stringify(call.payload ?? {});
  const headers = tc3Headers({ ...key, ...call, payload: body });
  // Fetch sets Host itself; sending it is harmless in RN but forbidden in browsers.
  delete headers.Host;
  const response = await fetch(`https://${call.host}/`, { method: "POST", headers, body });
  const text = await response.text();
  if (response.status < 200 || response.status > 299) throw parseTencentError(text);
  const envelope = JSON.parse(text) as { Response: T & { Error?: { Code: string; Message: string } } };
  if (envelope.Response?.Error) throw new TencentApiError(envelope.Response.Error.Code, envelope.Response.Error.Message);
  return envelope.Response;
}

/** "yyyy-MM-dd HH:mm:ss" (UTC) → ISO 8601. */
export function parseTencentDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return undefined;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)).toISOString();
}
