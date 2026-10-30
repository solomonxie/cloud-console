// Display formatting that matches the Swift app's Foundation formatters,
// written by hand so it's identical in Hermes (patchy Intl) and Chrome.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function toDate(value: number | string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Mar 4, 2026" */
export function formatDate(value: number | string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Mar 4" */
export function formatMonthDay(value: number | string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "3:05 PM" */
export function formatTime(value: number | string | Date): string {
  const d = toDate(value);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "15:05:09" */
export function formatClock(value: number | string | Date): string {
  const d = toDate(value);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** "Mar 4, 2026 at 3:05 PM" */
export function formatDateTime(value: number | string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${formatDate(d)} at ${formatTime(d)}`;
}

/** "2026-03-01" (UTC) → "March 2026". */
export function monthLabel(periodStart: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(periodStart);
  if (!m) return periodStart;
  return `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-03-04" (UTC) → "Mar 4". */
export function dayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** ByteCountFormatter `.file` style (decimal): "18 KB", "1.2 MB". */
export function byteCount(bytes: number): string {
  if (bytes === 0) return "Zero KB";
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** Binary (KiB-style, labelled KB like Apple's `.binary`) — for metrics. */
export function byteCountBinary(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥", CAD: "CA$" };

/** "$1,234.56" / "¥1,898.95"; negative as "-$3.00". */
export function formatCurrency(amount: number, code: string): string {
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const abs = Math.abs(amount);
  const [int, frac] = abs.toFixed(2).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}${symbol}${grouped}.${frac}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
