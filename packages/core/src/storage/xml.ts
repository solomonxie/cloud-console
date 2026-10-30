// XML response parsing via fast-xml-parser (React Native has no DOMParser).
// Values stay strings exactly as sent: no number coercion (a key named
// "0001" must stay "0001") and no trimming (keys may start/end with spaces).
import { XMLParser } from "fast-xml-parser";

export type XmlNode = { [tag: string]: XmlValue };
export type XmlValue = string | XmlNode | XmlValue[];

export function parseXml(xml: string, arrayTags: string[]): XmlNode {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: false,
    htmlEntities: true, // numeric character references (&#x0D; etc)
    isArray: (name) => arrayTags.includes(name),
  });
  return parser.parse(xml) as XmlNode;
}

export function child(node: XmlValue | undefined, tag: string): XmlValue | undefined {
  return node && typeof node === "object" && !Array.isArray(node) ? node[tag] : undefined;
}

export function children(node: XmlValue | undefined, tag: string): XmlValue[] {
  const v = child(node, tag);
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function text(node: XmlValue | undefined, tag: string): string {
  const v = child(node, tag);
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !Array.isArray(v) && typeof v["#text"] === "string") {
    return v["#text"];
  }
  return "";
}

// Error bodies from S3 and Azure are small XML docs with the same shape:
// <Error><Code>..</Code><Message>..</Message></Error>.
export function errorFromXml(body: string): { code?: string; message?: string } {
  return {
    code: body.match(/<Code>([^<]*)<\/Code>/)?.[1],
    message: body.match(/<Message>([^<]*)<\/Message>/)?.[1],
  };
}
