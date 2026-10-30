// Relative dates in the demo fixtures (port of DemoCloud.resolve):
//   "@today-3 10:00"      → Date
//   "@ymd month-2"        → "yyyy-MM-dd" (first of that month)
//   "@iso today-9 15:22"  → "yyyy-MM-dd'T'HH:mm:ss.SSSZ" (local offset, Lambda's LastModified shape)
//   "…{today-3}…"         → "yyyy-MM-dd" spliced into the string
// All in the device's local time zone, like Swift's Calendar.current.

const TOKEN = /^(today|month)([+-]\d+)?(?: (\d{1,2}):(\d{2}))?$/;
const INLINE = /\{((?:today|month)(?:[+-]\d+)?)\}/g;

/** `today±N[ HH:mm]` (days) or `month±N[ HH:mm]` (first day of that month). */
export function demoDate(text: string, now: Date): Date | undefined {
  const m = TOKEN.exec(text);
  if (!m) return undefined;
  const amount = m[2] ? Number(m[2]) : 0;
  const day =
    m[1] === "today"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + amount)
      : new Date(now.getFullYear(), now.getMonth() + amount, 1);
  if (m[3] === undefined || m[4] === undefined) return day;
  day.setHours(Number(m[3]), Number(m[4]), 0, 0);
  return day;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** yyyy-MM-dd'T'HH:mm:ss.SSSZ, e.g. 2026-10-21T15:22:00.000-0700 */
export function isoWithOffset(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  );
}

function resolveString(text: string, now: Date): unknown {
  if (text.startsWith("@ymd ")) {
    const d = demoDate(text.slice(5), now);
    if (d) return ymd(d);
  }
  if (text.startsWith("@iso ")) {
    const d = demoDate(text.slice(5), now);
    if (d) return isoWithOffset(d);
  }
  if (text.startsWith("@")) {
    const d = demoDate(text.slice(1), now);
    if (d) return d;
  }
  if (!text.includes("{")) return text;
  return text.replace(INLINE, (whole, token: string) => {
    const d = demoDate(token, now);
    return d ? ymd(d) : whole;
  });
}

/** Deep-resolves every date token. `@today…` becomes a `Date` object. */
export function resolveDemo(value: unknown, now: Date): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveDemo(v, now));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDemo(v, now)]));
  }
  if (typeof value === "string") return resolveString(value, now);
  return value;
}

/** Dates → ISO 8601 strings: the shape every model in core uses. */
export function jsonifyDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonifyDates);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonifyDates(v)]));
  }
  return value;
}
