// AWS list and detail building blocks, mirroring the mobile app's
// ResourceList (one global list) and RegionalList (every enabled region,
// scanned one at a time, grouped with counts, failed regions noted), on the
// side panel's GCP-style rows, filter box and "N of M" stats.
import { scanRegions, type RegionalScanState } from "@cloud-console/core/regional";
import { REGION_NAMES } from "@cloud-console/core/aws/regions";
import type { DetailField } from "@cloud-console/core/detail";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import type { Screen } from "../app/nav.ts";
import { emptyState, h, icon, iconButton, statusLine } from "../gcp/dom.ts";
import { decorateFavorites } from "../lib/favorites.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import { awsCache, awsRegions, cacheKey } from "./common.ts";

export interface RowSpec {
  icon: string;
  title: string;
  subtitle?: string;
  pill?: HTMLElement;
  search: string;
  favId: string;
  onOpen: () => void;
}

export function resourceRow(spec: RowSpec): HTMLElement {
  const badge = h("span", { class: "badge" }, icon(spec.icon));
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0, "data-search": spec.search, "data-fav-id": spec.favId },
    badge,
    h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title", title: spec.title }, spec.title), spec.subtitle ? h("small", { title: spec.subtitle }, spec.subtitle) : null),
    spec.pill ?? null,
    h("div", { class: "actions" })
  );
  row.addEventListener("click", spec.onOpen);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") spec.onOpen();
  });
  return row;
}

// Running → ok, stopped → off, in-between → busy (EC2 states, rule states…).
export function statePill(state: string | undefined): HTMLElement | undefined {
  if (!state) return undefined;
  const s = state.toLowerCase();
  const tone =
    s === "running" || s === "enabled" || s === "ok" ? "ok"
    : s === "stopped" || s === "terminated" || s === "disabled" || s === "impaired" ? "off"
    : s === "pending" || s === "stopping" || s === "shutting-down" || s === "initializing" ? "busy"
    : "muted";
  return h("span", { class: `gcp-pill ${tone}` }, s);
}

interface ListOpts<T> {
  conn: StorageConnection;
  kind: string; // favorites scope + cache kind
  title: string;
  noun: [string, string];
  filter: string;
  emptyIcon: string;
  row: (item: T, region: string) => RowSpec;
}

function plural(n: number, [one, many]: [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Every enabled region, one at a time, grouped by region with counts. Empty
// regions are hidden; failed ones are listed behind a "N failed" note.
export function regionalListScreen<T>(opts: ListOpts<T> & { cacheKind: string; fetch: (region: string) => Promise<T[]> }): Screen {
  let state: RegionalScanState<T> = { results: [], scanning: "regions", scanned: 0, regionCount: 0 };
  let query = "";
  let generation = 0;
  const collapsed = new Set<string>();
  let refreshBtn: HTMLButtonElement;
  const listEl = h("div", { class: "gcp-list-body" });
  const status = h("div", { class: "aws-scan-status" });
  const failures = h("div", { class: "aws-failures", hidden: true });
  const filter = filterBox(opts.filter, (q) => {
    query = q;
    applyQuery();
  });
  let groups: { region: string; el: HTMLElement; rows: HTMLElement[]; count: HTMLElement }[] = [];

  const applyQuery = () => {
    let shown = 0;
    let total = 0;
    for (const g of groups) {
      const n = applyFilter(g.rows, query);
      shown += n;
      total += g.rows.length;
      g.el.hidden = n === 0;
      g.count.textContent = query ? `${n}/${g.rows.length}` : String(g.rows.length);
    }
    renderStatus(shown, total);
  };

  const renderStatus = (shown: number, total: number) => {
    const failed = state.results.filter((r) => r.error);
    const parts: (Node | string)[] = [];
    if (state.scanning) {
      parts.push(icon("loader"), h("span", {}, state.scanning === "regions" ? "Finding regions…" : `Scanning ${state.scanning} (${state.scanned + 1}/${state.regionCount})…`));
    } else {
      const n = plural(total, opts.noun);
      parts.push(h("span", {}, `${query ? `${shown} of ${n}` : n} · ${state.regionCount} regions`));
    }
    if (failed.length) {
      const btn = h("button", { type: "button", class: "link-btn aws-failed-btn" }, icon("alertCircle"), `${failed.length} failed`);
      btn.addEventListener("click", () => {
        failures.hidden = !failures.hidden;
      });
      parts.push(h("span", { class: "spacer" }), btn);
    }
    status.replaceChildren(...parts);
    if (refreshBtn) refreshBtn.disabled = !!state.scanning;
    failures.replaceChildren(
      h("div", { class: "aws-failures-title" }, "Regions that failed"),
      ...failed.map((r) => h("div", { class: "aws-failure" }, h("b", {}, r.region), " ", r.error ?? ""))
    );
    if (!failed.length) failures.hidden = true;
  };

  const render = () => {
    const visible = state.results.filter((r) => r.items.length > 0);
    const allRows: HTMLElement[] = [];
    groups = visible.map((result) => {
      const rows = result.items.map((item) => resourceRow(opts.row(item, result.region)));
      allRows.push(...rows);
      const count = h("span", { class: "aws-region-count" }, String(rows.length));
      const chevron = h("span", { class: "gcp-chevron" }, icon("chevronRight"));
      const head = h(
        "button",
        { type: "button", class: "aws-region-head", "aria-expanded": String(!collapsed.has(result.region)) },
        h("span", { class: "aws-region-id" }, result.region),
        REGION_NAMES[result.region] ? h("small", {}, REGION_NAMES[result.region]) : null,
        h("span", { class: "spacer" }),
        count,
        chevron
      );
      const list = h("div", { class: "gcp-list" }, ...rows);
      const el = h("section", { class: `aws-region${collapsed.has(result.region) ? "" : " open"}` }, head, list);
      list.hidden = collapsed.has(result.region);
      head.addEventListener("click", () => {
        const open = list.hidden !== false;
        list.hidden = !open;
        el.classList.toggle("open", open);
        head.setAttribute("aria-expanded", String(open));
        if (open) collapsed.delete(result.region);
        else collapsed.add(result.region);
      });
      return { region: result.region, el, rows, count };
    });
    if (!groups.length) {
      listEl.replaceChildren(
        state.scanning ? statusLine("loading", "Scanning regions…") : emptyState(opts.emptyIcon, opts.title, `Nothing in any of ${state.regionCount} regions.`)
      );
    } else {
      listEl.replaceChildren(...groups.map((g) => g.el));
      // One scope across regions; a row's id carries its region.
      for (const g of groups) void decorateFavorites(`aws:${opts.conn.id}:${opts.kind}`, g.rows);
    }
    filter.hidden = allRows.length === 0;
    applyQuery();
  };

  const load = async (force: boolean) => {
    const gen = ++generation;
    await scanRegions<T>({
      key: (region) => cacheKey(opts.cacheKind, opts.conn, region),
      regions: () => awsRegions(opts.conn, force),
      fetch: (region) => opts.fetch(region),
      cache: { cached: (key, ttl, f, get) => awsCache.cached(key, ttl, f, get), stale: (key) => awsCache.stale(key) },
      forceRefresh: force,
      previous: state.results,
      onUpdate: (s) => {
        if (gen !== generation) return;
        // scanRegions replaces `results` only when a region finished;
        // progress ticks just update the status line.
        const changed = s.results !== state.results || !s.scanning;
        state = s;
        if (changed) render();
        else applyQuery();
      },
      isCancelled: () => gen !== generation,
    });
  };

  return {
    title: opts.title,
    subtitle: opts.conn.name || undefined,
    render(body, header) {
      body.classList.add("gcp-screen", "aws-regional");
      refreshBtn = iconButton("refresh", "Refresh", () => void load(true));
      header.actions.append(refreshBtn);
      body.append(filter, status, failures, listEl);
      filter.hidden = true;
      void load(false);
    },
    onLeave() {
      generation++;
    },
  };
}

// --- Detail page pieces ---------------------------------------------------

export function section(title: string, ...content: (Node | null)[]): HTMLElement {
  return h("section", { class: "gcp-detail-section" }, h("h3", {}, title), ...content);
}

export function detailList(fields: DetailField[] | [string, string | undefined][]): HTMLElement {
  const dl = h("dl", { class: "detail-meta aws-meta" });
  for (const f of fields) {
    const [label, value] = Array.isArray(f) ? f : [f.label, f.value];
    if (value === undefined || value === "") continue;
    dl.append(h("dt", {}, label), h("dd", {}, value));
  }
  return dl;
}

export function codeBlock(text: string): HTMLElement {
  return h("pre", { class: "gcp-serial-output aws-code" }, text);
}

// A <details> that loads its content the first time it opens.
export function lazyDisclosure(summary: Node, load: (into: HTMLElement) => Promise<void>): HTMLElement {
  const body = h("div", { class: "aws-disclosure-body" });
  const el = h("details", { class: "aws-disclosure" }, h("summary", {}, summary), body);
  let loaded = false;
  el.addEventListener("toggle", () => {
    if (el.open && !loaded) {
      loaded = true;
      void load(body);
    }
  });
  return el;
}

export function screenSubtitle(conn: StorageConnection, region?: string): string | undefined {
  return [region, conn.name].filter(Boolean).join(" · ") || undefined;
}
