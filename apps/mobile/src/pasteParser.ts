// Liberal key:value / key=value parser for pasted credentials — handles
// whitespace, trailing commas/quotes, "export " prefixes, and common
// id/secret spellings. Only returns fields the block actually named.
const ID_KEYS = new Set(["accesskeyid", "awsaccesskeyid", "id", "accesskey", "key", "secretid"]);
const SECRET_KEYS = new Set(["secretaccesskey", "awssecretaccesskey", "secret", "secretkey"]);

export function parsePastedCredential(text: string): { id?: string; secret?: string } {
  const out: { id?: string; secret?: string } = {};
  for (const raw of text.split(/\r?\n/)) {
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
