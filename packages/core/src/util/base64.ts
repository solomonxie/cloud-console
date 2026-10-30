// Pure-JS base64 so Azure's base64 account keys and signatures work the
// same in Chrome and React Native (no reliance on atob/btoa).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

export function base64ToBytes(str: string): Uint8Array {
  const clean = str.replace(/[\s=]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let j = 0;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new Error("Invalid base64 string");
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, j);
}
