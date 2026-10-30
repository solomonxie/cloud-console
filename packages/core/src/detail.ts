// Read-only key/value detail rows shared by the simpler resource pages.
export interface DetailField {
  label: string;
  value: string;
}

export interface DetailDocument {
  title: string;
  text: string;
}

export interface ResourceDetail {
  fields: DetailField[];
  documents: DetailDocument[];
}

/** Drops empty values; stringifies the rest (Swift's `fields(_:)` helper). */
export function fields(pairs: [string, unknown][]): DetailField[] {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([label, v]) => ({ label, value: String(v) }));
}

/** Pretty JSON with sorted keys; non-JSON text passes through. */
export function prettyJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) ?? String(value);
}

export function prettyJsonString(raw: string): string {
  try {
    return prettyJson(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}
