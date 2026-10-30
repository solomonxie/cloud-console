// Shared AWS error shapes: the Query APIs' XML (S3, IAM, STS, EC2, CloudWatch)
// and the JSON-protocol services' `{"__type": ..., "message": ...}`.
import { walkXml } from "./xml.ts";

export class AwsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly awsMessage: string;

  constructor(status: number, code: string, awsMessage: string, display?: string) {
    super(display ?? `${code}: ${awsMessage}`);
    this.name = "AwsError";
    this.status = status;
    this.code = code;
    this.awsMessage = awsMessage;
  }
}

export function badResponse(status: number, body: string): AwsError {
  return new AwsError(status, "", body, `AWS returned ${status}: ${body}`);
}

export function parseQueryError(status: number, body: string): AwsError {
  let code = "";
  let message = "";
  walkXml(body, (path, text) => {
    const last = path[path.length - 1];
    if (last === "Code") code = text;
    else if (last === "Message") message = text;
  });
  if (!code) return badResponse(status, body);
  return new AwsError(status, code, message);
}

export function parseJsonError(status: number, body: string): AwsError {
  let object: Record<string, unknown>;
  try {
    object = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return badResponse(status, body);
  }
  if (!object || typeof object !== "object") return badResponse(status, body);
  const type = typeof object.__type === "string" ? (object.__type.split("#").pop() ?? "Error") : "Error";
  const message =
    typeof object.message === "string" ? object.message : typeof object.Message === "string" ? object.Message : "";
  return new AwsError(status, type, message);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
