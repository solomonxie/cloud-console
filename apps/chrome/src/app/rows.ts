// One list row for the kind screens (EC2, CVM, CAM, …): badge, title,
// subtitle, a star slot and a chevron when it opens something. Built on
// sidepanel.css .row and gcp.css's two-line/chevron classes.
import { h, icon } from "../gcp/dom.ts";

export interface RowSpec {
  // Stable id within the list (favorites key).
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
  // Extra searchable text beyond title and subtitle.
  search?: string;
  open?: () => void;
}

export function kindRow(spec: RowSpec): HTMLElement {
  const badge = h("span", { class: "badge" }, icon(spec.icon));
  const row = h(
    "div",
    {
      class: `row gcp-row${spec.open ? " selectable" : ""}`,
      tabindex: spec.open ? 0 : undefined,
      "data-search": [spec.title, spec.subtitle, spec.search].filter(Boolean).join(" "),
      "data-fav-id": spec.id,
    },
    badge,
    h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title", title: spec.title }, spec.title), spec.subtitle ? h("small", { title: spec.subtitle }, spec.subtitle) : null),
    h("div", { class: "actions" }),
    spec.open ? h("span", { class: "gcp-chevron" }, icon("chevronRight")) : null
  );
  const open = spec.open;
  if (open) {
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === row) open();
    });
  }
  return row;
}

// "3 users" / "1 of 3 users".
export function countText(total: number, shown: number, filtered: boolean, noun: [string, string]): string {
  const n = `${total} ${total === 1 ? noun[0] : noun[1]}`;
  return filtered ? `${shown} of ${n}` : n;
}
