// A flat resource list (port of the mobile app's ResourceList): filter box,
// "N of M" count, refresh, favorites pinned on top. Rows push detail screens.
import { emptyState, h, iconButton, statusLine } from "../gcp/dom.ts";
import { decorateFavorites } from "../lib/favorites.ts";
import { errorMessage } from "../sidepanel/dom.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import type { Screen } from "./nav.ts";
import { countText, kindRow, type RowSpec } from "./rows.ts";

export interface ListScreenOpts<T> {
  title: string;
  subtitle?: string;
  noun: [singular: string, plural: string];
  emptyIcon: string;
  filterPlaceholder: string;
  // lib/favorites.ts scope, e.g. "tencent:<connId>:camUsers".
  favoritesScope: string;
  // `fresh`: an explicit refresh — skip the cache.
  load: (fresh: boolean) => Promise<T[]>;
  row: (item: T) => RowSpec;
}

export function listScreen<T>(opts: ListScreenOpts<T>): Screen {
  let rows: HTMLElement[] = [];
  let query = "";
  let generation = 0;
  const listEl = h("div", { class: "gcp-list-body" });
  const stats = h("div", { class: "list-stats", hidden: true });
  const filter = filterBox(opts.filterPlaceholder, (q) => {
    query = q;
    updateStats();
  });
  filter.hidden = true;

  function updateStats(): void {
    const shown = applyFilter(rows, query);
    stats.textContent = countText(rows.length, shown, !!query, opts.noun);
  }

  async function load(fresh: boolean): Promise<void> {
    const gen = ++generation;
    rows = [];
    filter.hidden = true;
    stats.hidden = true;
    listEl.replaceChildren(statusLine("loading", `Loading ${opts.noun[1]}…`));
    let items: T[];
    try {
      items = await opts.load(fresh);
    } catch (err) {
      if (gen !== generation) return;
      listEl.replaceChildren(statusLine("error", `Couldn't load ${opts.noun[1]}: ${errorMessage(err)}`));
      return;
    }
    if (gen !== generation) return;
    if (!items.length) {
      listEl.replaceChildren(emptyState(opts.emptyIcon, opts.title, "Nothing here yet."));
      return;
    }
    rows = items.map((item) => kindRow(opts.row(item)));
    listEl.replaceChildren(h("div", { class: "gcp-list" }, ...rows));
    filter.hidden = false;
    stats.hidden = false;
    updateStats();
    void decorateFavorites(opts.favoritesScope, rows);
  }

  return {
    title: opts.title,
    subtitle: opts.subtitle,
    render(body, header) {
      body.classList.add("gcp-screen");
      header.actions.append(iconButton("refresh", "Refresh", () => void load(true)));
      body.append(filter, listEl, stats);
      void load(false);
    },
    onLeave() {
      generation++;
    },
  };
}
