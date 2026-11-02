// Resources grouped by region, scanned one region at a time (port of the
// mobile app's RegionalList over core's scanRegions): each region folds and
// shows its count, empty regions are hidden, failed regions are listed in a
// note under the list. One filter box spans every region.
import { scanRegions, type RegionalScanState } from "@cloud-console/core/regional";
import { emptyState, h, icon, iconButton, statusLine } from "../gcp/dom.ts";
import { decorateFavorites } from "../lib/favorites.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import type { Screen } from "./nav.ts";
import { resourceCache } from "./resource-cache.ts";
import { countText, kindRow, type RowSpec } from "./rows.ts";

export interface RegionalScreenOpts<T> {
  title: string;
  subtitle?: string;
  noun: [singular: string, plural: string];
  emptyIcon: string;
  filterPlaceholder: string;
  favoritesScope: string;
  // Cache key per region, e.g. `cvm-instances@${region}:${connId}`.
  cacheKey: (region: string) => string;
  regions: () => Promise<string[]>;
  fetch: (region: string) => Promise<T[]>;
  row: (item: T, region: string) => RowSpec;
}

export function regionalScreen<T>(opts: RegionalScreenOpts<T>): Screen {
  let generation = 0;
  let query = "";
  let state: RegionalScanState<T> = { results: [], scanning: "regions", scanned: 0, regionCount: 0 };
  const collapsed = new Set<string>();
  let rows: HTMLElement[] = [];
  let refreshBtn: HTMLButtonElement;

  const listEl = h("div", { class: "region-groups" });
  const stats = h("div", { class: "list-stats" });
  const failures = h("div", { class: "region-failures", hidden: true });
  const filter = filterBox(opts.filterPlaceholder, (q) => {
    query = q;
    updateStats();
  });
  filter.hidden = true;

  function updateStats(): void {
    const shown = applyFilter(rows, query);
    // Hide a region group whose rows are all filtered out.
    for (const group of listEl.querySelectorAll<HTMLElement>(".region-group")) {
      group.hidden = !!query && !group.querySelector(".row:not([hidden])");
    }
    const regions = state.regionCount ? ` · ${state.regionCount} regions` : "";
    const scanning = state.scanning === "regions" ? "Finding regions…" : state.scanning ? `Scanning ${state.scanning} (${state.scanned + 1}/${state.regionCount})…` : "";
    stats.textContent = scanning || countText(rows.length, shown, !!query, opts.noun) + regions;
  }

  function render(): void {
    const visible = state.results.filter((r) => r.items.length > 0);
    rows = [];
    const groups = visible.map((result) => {
      const groupRows = result.items.map((item) => kindRow(opts.row(item, result.region)));
      rows.push(...groupRows);
      const list = h("div", { class: "gcp-list" }, ...groupRows);
      const head = h(
        "button",
        { type: "button", class: "region-head", "aria-expanded": String(!collapsed.has(result.region)) },
        h("span", { class: "region-name" }, result.region),
        h("span", { class: "spacer" }),
        h("span", { class: "region-count" }, String(result.items.length)),
        h("span", { class: "gcp-chevron" }, icon("chevronRight"))
      );
      const group = h("section", { class: `region-group${collapsed.has(result.region) ? "" : " open"}` }, head, list);
      list.hidden = collapsed.has(result.region);
      head.addEventListener("click", () => {
        const open = collapsed.has(result.region);
        if (open) collapsed.delete(result.region);
        else collapsed.add(result.region);
        list.hidden = !open;
        group.classList.toggle("open", open);
        head.setAttribute("aria-expanded", String(open));
      });
      void decorateFavorites(opts.favoritesScope, groupRows);
      return group;
    });
    if (groups.length) listEl.replaceChildren(...groups);
    else if (state.scanning) listEl.replaceChildren(statusLine("loading", `Loading ${opts.noun[1]}…`));
    else if (state.regionCount) listEl.replaceChildren(emptyState(opts.emptyIcon, opts.title, `Nothing in any of ${state.regionCount} regions.`));
    else listEl.replaceChildren();

    const failed = state.results.filter((r) => r.error);
    failures.hidden = failed.length === 0;
    failures.replaceChildren(
      ...(failed.length
        ? [
            h("div", { class: "region-failures-head" }, icon("alertCircle"), `${failed.length} region${failed.length === 1 ? "" : "s"} failed`),
            ...failed.map((r) => h("div", { class: "region-failure" }, h("strong", {}, r.region), ` ${r.error}`)),
          ]
        : [])
    );
    filter.hidden = rows.length === 0;
    refreshBtn.disabled = !!state.scanning;
    updateStats();
  }

  async function load(fresh: boolean): Promise<void> {
    const gen = ++generation;
    try {
      await scanRegions<T>({
        key: opts.cacheKey,
        regions: opts.regions,
        fetch: opts.fetch,
        cache: resourceCache,
        forceRefresh: fresh,
        previous: state.results,
        onUpdate: (s) => {
          if (gen !== generation) return;
          state = s;
          render();
        },
        isCancelled: () => gen !== generation,
      });
    } catch (err) {
      if (gen !== generation) return;
      state = { ...state, scanning: undefined };
      render();
      listEl.replaceChildren(statusLine("error", `Couldn't load ${opts.noun[1]}: ${(err as Error)?.message ?? String(err)}`));
    }
  }

  return {
    title: opts.title,
    subtitle: opts.subtitle,
    render(body, header) {
      body.classList.add("gcp-screen");
      refreshBtn = iconButton("refresh", "Refresh", () => void load(true));
      header.actions.append(refreshBtn);
      body.append(filter, listEl, failures, stats);
      void load(false);
    },
    onLeave() {
      generation++;
    },
  };
}
