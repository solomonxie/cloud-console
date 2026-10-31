// Search for long lists: a filter box that narrows already-loaded rows, and
// a combobox (type or pick) for choices like GCP projects that can number
// in the hundreds — never a long native <select> to scroll through.
import { h, icon } from "../gcp/dom.ts";

// Case-insensitive "every word appears somewhere" match.
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

// A sticky search box. `onChange` fires on every keystroke with the trimmed
// query. Escape clears it.
export function filterBox(placeholder: string, onChange: (query: string) => void): HTMLElement {
  const input = h("input", { type: "search", placeholder, "aria-label": placeholder, autocomplete: "off", spellcheck: "false" });
  input.addEventListener("input", () => onChange(input.value.trim()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      e.stopPropagation();
      input.value = "";
      onChange("");
    }
  });
  return h("label", { class: "filter-box" }, icon("search"), input);
}

// Hides each row whose text doesn't match; returns how many stay visible.
// Rows carry their searchable text in data-search (set by the caller) or
// fall back to textContent.
export function applyFilter(rows: Iterable<HTMLElement>, query: string): number {
  let shown = 0;
  for (const row of rows) {
    const ok = !query || matches(query, row.dataset.search ?? row.textContent ?? "");
    row.hidden = !ok;
    if (ok) shown++;
  }
  return shown;
}

export interface ComboOption {
  value: string;
  label: string;
  detail?: string;
}

// Text input with a filtered dropdown. Picking an option, or pressing Enter
// on free text when `allowFreeText` (e.g. a project ID the credential can
// use but not list), calls onPick.
export function combobox(opts: {
  placeholder: string;
  options: ComboOption[];
  value?: string;
  allowFreeText?: boolean;
  onPick: (value: string) => void;
}): { el: HTMLElement; setOptions(options: ComboOption[], value?: string): void; setDisabled(d: boolean): void } {
  let options = opts.options;
  let value = opts.value ?? "";
  let active = -1;
  const input = h("input", {
    type: "text",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    placeholder: opts.placeholder,
    "aria-label": opts.placeholder,
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = h("ul", { class: "combo-list", role: "listbox", hidden: true });
  const el = h("div", { class: "combo" }, icon("search"), input, icon("chevronDown"), list);

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const showValue = () => {
    input.value = labelOf(value);
  };
  const visible = () => {
    const q = input.value === labelOf(value) ? "" : input.value.trim();
    return options.filter((o) => !q || matches(q, o.label, o.value, o.detail));
  };
  const render = () => {
    const items = visible();
    list.replaceChildren();
    items.slice(0, 200).forEach((o, i) => {
      const li = h(
        "li",
        { role: "option", class: `${i === active ? "active" : ""} ${o.value === value ? "current" : ""}`.trim(), "aria-selected": String(o.value === value) },
        h("span", {}, o.label),
        o.detail ? h("small", {}, o.detail) : null
      );
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(o.value);
      });
      list.append(li);
    });
    if (!items.length) {
      list.append(h("li", { class: "muted" }, opts.allowFreeText && input.value.trim() ? `Press Enter to use “${input.value.trim()}”` : "No matches"));
    } else if (items.length > 200) {
      list.append(h("li", { class: "muted" }, `${items.length - 200} more — keep typing to narrow`));
    }
  };
  const open = () => {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    render();
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
    showValue();
  };
  const pick = (v: string) => {
    value = v;
    close();
    input.blur();
    opts.onPick(v);
  };

  input.addEventListener("focus", () => {
    input.select();
    open();
  });
  input.addEventListener("input", () => {
    active = 0;
    open();
  });
  input.addEventListener("blur", () => close());
  input.addEventListener("keydown", (e) => {
    const items = visible();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) open();
      const n = Math.min(items.length, 200);
      if (n) active = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = items[active >= 0 ? active : 0];
      if (hit) pick(hit.value);
      else if (opts.allowFreeText && input.value.trim()) pick(input.value.trim());
    } else if (e.key === "Escape") {
      e.stopPropagation();
      close();
      input.blur();
    }
  });

  showValue();
  return {
    el,
    setOptions(next, v) {
      options = next;
      if (v !== undefined) value = v;
      showValue();
      if (!list.hidden) render();
    },
    setDisabled(d) {
      input.disabled = d;
    },
  };
}
