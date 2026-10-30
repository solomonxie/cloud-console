// Tiny DOM helpers for the GCP section (vanilla TS, no framework).

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "class") {
      el.className = String(v);
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

// Feather-style 24x24 stroke icons, matching the sidepanel's icon set.
const PATHS: Record<string, string> = {
  cloud: `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>`,
  server: `<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>`,
  layers: `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
  key: `<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>`,
  plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  refresh: `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
  external: `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
  copy: `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  eye: `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.62 21.62 0 0 1 5.06-6.06M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.61 3.87M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`,
  chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
  chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
  play: `<polygon points="5 3 19 12 5 21 5 3"/>`,
  square: `<rect x="5" y="5" width="14" height="14" rx="1"/>`,
  rotate: `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`,
  terminal: `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
  alertCircle: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/>`,
  loader: `<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>`,
  inbox: `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
  x: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  trash: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
};

export function icon(name: keyof typeof PATHS | string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = PATHS[name] ?? "";
  return svg;
}

export function iconButton(name: string, title: string, onClick: (e: MouseEvent) => void, extraClass = ""): HTMLButtonElement {
  const btn = h("button", { type: "button", class: `icon-btn ${extraClass}`.trim(), title, "aria-label": title });
  btn.appendChild(icon(name));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return btn;
}

export function externalLink(href: string, title = "Open in Google Cloud console"): HTMLAnchorElement {
  const a = h("a", { class: "icon-btn", href, target: "_blank", rel: "noopener noreferrer", title, "aria-label": title });
  a.appendChild(icon("external"));
  a.addEventListener("click", (e) => e.stopPropagation());
  return a;
}

export function emptyState(iconName: string, primary: string, secondary?: string): HTMLElement {
  return h("div", { class: "empty-state" }, icon(iconName), h("div", { class: "primary" }, primary), secondary ? h("div", {}, secondary) : null);
}

export function statusLine(kind: "loading" | "error" | "info", message: string): HTMLElement {
  const el = h("div", { class: `status ${kind === "info" ? "" : kind}`.trim() });
  el.append(icon(kind === "loading" ? "loader" : kind === "error" ? "alertCircle" : "inbox"), h("span", {}, message));
  return el;
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// Modal confirm built on <dialog>, matching the sidepanel's alert dialog.
export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "alert-dialog gcp-dialog" });
    const done = (ok: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(ok);
    };
    dialog.append(
      h("h2", {}, opts.title),
      h("p", {}, opts.message),
      h(
        "div",
        { class: "modal-actions" },
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn", onclick: () => done(false) }, "Cancel"),
        h("button", { type: "button", class: `btn ${opts.danger ? "danger" : "primary"}`, onclick: () => done(true) }, opts.confirmLabel)
      )
    );
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export async function copyText(text: string, button?: HTMLElement): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (button) {
    button.classList.add("gcp-copied");
    setTimeout(() => button.classList.remove("gcp-copied"), 1200);
  }
}
