// Read-only detail page (port of the mobile app's detail.tsx / event.tsx):
// a field list plus JSON documents (event patterns, targets, …). `load`
// may be static (fields known from the list) or fetch on open.
import type { ResourceDetail } from "@cloud-console/core/detail";
import { h, iconButton, statusLine } from "../gcp/dom.ts";
import { errorMessage } from "../sidepanel/dom.ts";
import type { Screen } from "./nav.ts";

export function detailSection(title: string, ...content: (Node | null)[]): HTMLElement {
  return h("section", { class: "gcp-detail-section" }, h("h3", {}, title), ...content);
}

export function fieldList(fields: { label: string; value: string }[]): HTMLElement {
  const meta = h("dl", { class: "detail-meta" });
  for (const f of fields) meta.append(h("dt", {}, f.label), h("dd", {}, f.value));
  return meta;
}

export function codeBlock(text: string): HTMLElement {
  return h("pre", { class: "gcp-serial-output detail-doc" }, text);
}

export function detailScreen(opts: { title: string; subtitle?: string; load: () => Promise<ResourceDetail> | ResourceDetail; refreshable?: boolean }): Screen {
  let body: HTMLElement;
  let generation = 0;

  async function load(): Promise<void> {
    const gen = ++generation;
    body.replaceChildren(statusLine("loading", "Loading…"));
    let detail: ResourceDetail;
    try {
      detail = await opts.load();
    } catch (err) {
      if (gen !== generation) return;
      body.replaceChildren(statusLine("error", errorMessage(err)));
      return;
    }
    if (gen !== generation) return;
    body.replaceChildren(detailSection("Details", fieldList(detail.fields)), ...detail.documents.map((d) => detailSection(d.title, codeBlock(d.text))));
  }

  return {
    title: opts.title,
    subtitle: opts.subtitle,
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail");
      if (opts.refreshable) header.actions.append(iconButton("refresh", "Refresh", () => void load()));
      void load();
    },
    onLeave() {
      generation++;
    },
  };
}
