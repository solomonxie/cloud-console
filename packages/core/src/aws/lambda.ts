// AWS Lambda — plain REST/JSON (not the Query API), region-specific.
import type { AwsKey } from "./sigv4.ts";
import { awsFetch } from "./http.ts";
import { base64Decode, utf8Decode } from "./encoding.ts";

export interface LambdaFunctionSummary {
  name: string;
  runtime?: string;
  memorySize?: number;
  lastModified?: string;
  arn?: string;
  handler?: string;
  timeout?: number;
  codeSize?: number;
  description?: string;
}

/** Result of a synchronous run. */
export interface LambdaInvocation {
  isError: boolean;
  status: string;
  response: string;
  log?: string;
  requestID?: string;
}

interface RawFunction {
  FunctionName: string;
  FunctionArn?: string;
  Runtime?: string;
  Handler?: string;
  MemorySize?: number;
  Timeout?: number;
  CodeSize?: number;
  Description?: string;
  LastModified?: string;
}

export function mapFunction(f: RawFunction): LambdaFunctionSummary {
  return {
    name: f.FunctionName,
    runtime: f.Runtime,
    memorySize: f.MemorySize,
    lastModified: f.LastModified,
    arn: f.FunctionArn,
    handler: f.Handler,
    timeout: f.Timeout,
    codeSize: f.CodeSize,
    description: f.Description,
  };
}

export async function listFunctions(key: AwsKey, region = "us-east-1"): Promise<LambdaFunctionSummary[]> {
  const functions: LambdaFunctionSummary[] = [];
  let marker: string | undefined;
  do {
    const url = new URL(`https://lambda.${region}.amazonaws.com/2015-03-31/functions/`);
    if (marker) url.searchParams.set("Marker", marker);
    const { text } = await awsFetch(key, { url: url.toString(), region, service: "lambda", errors: "json" });
    const decoded = JSON.parse(text) as { Functions: RawFunction[]; NextMarker?: string | null };
    functions.push(...decoded.Functions.map(mapFunction));
    marker = decoded.NextMarker ?? undefined;
  } while (marker);
  return functions;
}

/** Synchronous (RequestResponse) invoke with the last 4 KB of the log. */
export async function invoke(key: AwsKey, name: string, payload: string, region = "us-east-1"): Promise<LambdaInvocation> {
  const url = `https://lambda.${region}.amazonaws.com/2015-03-31/functions/${encodeURIComponent(name)}/invocations`;
  const response = await awsFetch(key, {
    method: "POST",
    url,
    region,
    service: "lambda",
    body: payload,
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Invocation-Type": "RequestResponse",
      "X-Amz-Log-Type": "Tail",
    },
    errors: "json",
  });
  const functionError = response.headers.get("X-Amz-Function-Error");
  const logHeader = response.headers.get("X-Amz-Log-Result");
  return {
    isError: functionError !== null,
    status: functionError !== null ? `Error · ${functionError}` : `Succeeded · ${response.status}`,
    response: response.text,
    log: logHeader ? utf8Decode(base64Decode(logHeader)) : undefined,
    requestID: response.headers.get("x-amzn-RequestId") ?? undefined,
  };
}
