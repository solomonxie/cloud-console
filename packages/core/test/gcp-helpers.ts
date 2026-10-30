/// <reference types="node" />
// Shared helpers for the GCP tests: read fixture files and route a mocked
// fetch by URL.
import { readFileSync } from "node:fs";
import { vi } from "vitest";

const FIXTURES = new URL("./fixtures/gcp/", import.meta.url);

export function fixtureText(name: string): string {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

export function fixtureJson<T = unknown>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Route = (call: Call) => { status?: number; fixture: string } | undefined;

// Installs a fetch mock that answers each request with the first matching
// route's fixture file; returns the recorded calls.
export function mockFetch(route: Route): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        url: new URL(input),
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string | undefined,
      };
      calls.push(call);
      if (call.url.host === "oauth2.googleapis.com") {
        return new Response(fixtureText("token-response.json"), { status: 200 });
      }
      const hit = route(call);
      if (!hit) return new Response(`no route for ${call.method} ${call.url}`, { status: 599 });
      return new Response(fixtureText(hit.fixture), { status: hit.status ?? 200 });
    })
  );
  return calls;
}

export function apiCalls(calls: Call[]): Call[] {
  return calls.filter((c) => c.url.host !== "oauth2.googleapis.com");
}
