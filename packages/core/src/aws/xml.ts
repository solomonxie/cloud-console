// Path-based XML walking, the TS port of the Swift `XMLPathParser`: reports
// each element's close with its ancestor path and trimmed text. Every AWS
// Query-API client (EC2, IAM, CloudWatch, STS errors) reads responses this
// way. fast-xml-parser is pure JS, so this runs in Hermes (no DOMParser).
import { XMLParser } from "fast-xml-parser";

export type OnEnd = (path: string[], text: string) => void;

type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

export function walkXml(xml: string, onEnd: OnEnd): void {
  let nodes: OrderedNode[];
  try {
    nodes = parser.parse(xml) as OrderedNode[];
  } catch {
    return;
  }
  visit(nodes, [], onEnd);
}

function visit(nodes: OrderedNode[], path: string[], onEnd: OnEnd): string {
  let text = "";
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === ":@" || key.startsWith("?")) continue;
      if (key === "#text") {
        text += String(node[key]);
        continue;
      }
      const childPath = [...path, key];
      const children = (node[key] as OrderedNode[] | undefined) ?? [];
      const childText = visit(children, childPath, onEnd);
      onEnd(childPath, childText.trim());
    }
  }
  return text;
}

/** `path[path.length - 1 - n]`, i.e. `path.dropLast(n).last` in Swift. */
export function ancestor(path: string[], n: number): string | undefined {
  return path[path.length - 1 - n];
}

/** First text of a tag anywhere in the document (last one wins, like the Swift helper). */
export function xmlField(xml: string, tag: string): string | undefined {
  let value: string | undefined;
  walkXml(xml, (path, text) => {
    if (path[path.length - 1] === tag) value = text;
  });
  return value;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
