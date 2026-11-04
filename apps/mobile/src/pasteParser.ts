// Liberal key:value / key=value parser for pasted credentials — handles
// whitespace, trailing commas/quotes, "export " prefixes, and common
// id/secret spellings, plus the console's accessKeys.csv. Only returns fields
// the block actually named.
const ID_KEYS = new Set(["accesskeyid", "awsaccesskeyid", "id", "accesskey", "key", "secretid"]);
const SECRET_KEYS = new Set(["secretaccesskey", "awssecretaccesskey", "secret", "secretkey"]);

export function parsePastedCredential(text: string): { id?: string; secret?: string } {
  const out: { id?: string; secret?: string } = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const csv = parseCsv(lines);
  if (csv) return csv;
  for (const raw of lines) {
    let line = raw.trim();
    if (line.startsWith("export ")) line = line.slice(7);
    const sep = line.search(/[:=]/);
    if (sep < 0) continue;
    let value = line.slice(sep + 1).trim();
    if (value.endsWith(",")) value = value.slice(0, -1);
    value = value.replace(/^["' ]+|["' ]+$/g, "");
    if (!value) continue;
    const key = line.slice(0, sep).toLowerCase().replace(/[^a-z]/g, "");
    if (ID_KEYS.has(key)) out.id = value;
    else if (SECRET_KEYS.has(key)) out.secret = value;
  }
  return out;
}

function parseCsv(lines: string[]): { id?: string; secret?: string } | undefined {
  const norm = (c: string) => c.trim().replace(/^"|"$/g, "");
  const header = (lines[0] ?? "").split(",").map((c) => norm(c).toLowerCase().replace(/[^a-z]/g, ""));
  const idCol = header.findIndex((h) => ID_KEYS.has(h));
  const secretCol = header.findIndex((h) => SECRET_KEYS.has(h));
  if (idCol < 0 || secretCol < 0 || header.length < 2) return undefined;
  const row = (lines.slice(1).find((l) => l.trim()) ?? "").split(",").map(norm);
  return { id: row[idCol] || undefined, secret: row[secretCol] || undefined };
}
