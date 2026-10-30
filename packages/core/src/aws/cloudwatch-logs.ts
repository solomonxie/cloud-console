// CloudWatch Logs — AWS JSON 1.1 protocol (POST + X-Amz-Target), region-specific.
import type { AwsKey } from "./sigv4.ts";
import { awsJson } from "./http.ts";
import { AwsError } from "./errors.ts";

export interface LogEvent {
  timestamp: number; // epoch ms
  message: string;
  stream: string;
}

export class NoLogGroupError extends Error {
  constructor() {
    super("No logs yet — the function hasn't run, or its role can't write logs.");
    this.name = "NoLogGroupError";
  }
}

/** Lambda writes to `/aws/lambda/<function>` by default. */
export function lambdaLogGroup(fn: string): string {
  return `/aws/lambda/${fn}`;
}

interface FilterResponse {
  events?: { timestamp: number; message: string; logStreamName?: string }[];
  nextToken?: string;
}

/** Events in `from...to` (epoch ms), oldest first, keeping only the newest `maxEvents`. */
export async function filterEvents(
  key: AwsKey,
  opts: { logGroup: string; from: number; to: number; maxEvents?: number; region?: string }
): Promise<LogEvent[]> {
  const region = opts.region ?? "us-east-1";
  const maxEvents = opts.maxEvents ?? 1000;
  let events: LogEvent[] = [];
  let nextToken: string | undefined;
  // FilterLogEvents can return empty pages with a token; cap the round trips.
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = {
      logGroupName: opts.logGroup,
      startTime: Math.floor(opts.from),
      endTime: Math.floor(opts.to),
    };
    if (nextToken) body.nextToken = nextToken;
    let decoded: FilterResponse;
    try {
      decoded = await awsJson<FilterResponse>(key, {
        url: `https://logs.${region}.amazonaws.com/`,
        region,
        service: "logs",
        target: "Logs_20140328.FilterLogEvents",
        body,
      });
    } catch (error) {
      if (error instanceof AwsError && error.code === "ResourceNotFoundException") throw new NoLogGroupError();
      throw error;
    }
    for (const e of decoded.events ?? []) {
      events.push({ timestamp: e.timestamp, message: e.message.replace(/^[\r\n]+|[\r\n]+$/g, ""), stream: e.logStreamName ?? "" });
    }
    if (events.length > maxEvents) events = events.slice(events.length - maxEvents);
    nextToken = decoded.nextToken;
    if (!nextToken) break;
  }
  return events;
}
