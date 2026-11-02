// Buckets: every bucket (Azure: container) a vendor-level storage
// connection's key can list, searchable; tapping one opens the bucket
// browser on a synthetic, never-saved connection — the stored keys plus that
// bucket (and, for AWS/COS/OSS, the bucket's own region).
import { listBuckets, type StorageBucket } from "@cloud-console/core/storage/buckets";
import { bucketConnection, connectionLabel, type StorageConnection } from "@cloud-console/core/storage/connection";
import { emptyState, formatTime, h, icon, iconButton, statusLine } from "../gcp/dom.ts";
import { decorateFavorites } from "../lib/favorites.ts";
import { bucketScreen } from "../sidepanel/bucket-screen.ts";
import { errorMessage } from "../sidepanel/dom.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import { nav, type Screen } from "./nav.ts";

export function bucketsScreen(conn: StorageConnection, title: string): Screen {
  const isAzure = conn.type === "azure";
  const [one, many] = isAzure ? ["container", "containers"] : ["bucket", "buckets"];
  let rows: HTMLElement[] = [];
  let query = "";
  let generation = 0;
  const listEl = h("div", { class: "gcp-list-body" });
  const stats = h("div", { class: "list-stats", hidden: true });

  const updateStats = () => {
    const shown = applyFilter(rows, query);
    const n = `${rows.length} ${rows.length === 1 ? one : many}`;
    stats.textContent = query ? `${shown} of ${n}` : n;
  };
  const filter = filterBox(isAzure ? "Filter containers" : "Filter by name or region", (q) => {
    query = q;
    updateStats();
  });
  filter.hidden = true;

  const load = async () => {
    const gen = ++generation;
    rows = [];
    filter.hidden = true;
    stats.hidden = true;
    listEl.replaceChildren(statusLine("loading", `Loading ${many}…`));
    let buckets: StorageBucket[];
    try {
      buckets = await listBuckets(conn);
    } catch (err) {
      if (gen !== generation) return;
      listEl.replaceChildren(statusLine("error", `Couldn't list ${many}: ${errorMessage(err)}`));
      return;
    }
    if (gen !== generation) return;
    if (!buckets.length) {
      listEl.replaceChildren(emptyState("database", `No ${many}`, `This key can't see any ${many}.`));
      return;
    }
    rows = buckets.map((b) => bucketRow(conn, b));
    listEl.replaceChildren(h("div", { class: "gcp-list" }, ...rows));
    filter.hidden = false;
    stats.hidden = false;
    updateStats();
    void decorateFavorites(`storage:${conn.id}:buckets`, rows);
  };

  return {
    title: isAzure ? "Containers" : "Buckets",
    subtitle: title,
    render(body, header) {
      body.classList.add("gcp-screen");
      header.actions.append(iconButton("refresh", "Refresh", () => void load()));
      body.append(filter, listEl, stats);
      void load();
    },
    onLeave() {
      generation++;
    },
  };
}

function bucketRow(conn: StorageConnection, bucket: StorageBucket): HTMLElement {
  const badge = h("span", { class: "badge folder" });
  badge.append(icon("database"));
  const sub = [bucket.region, bucket.creationDate ? `created ${formatTime(bucket.creationDate)}` : ""].filter(Boolean).join(" · ");
  const row = h(
    "div",
    {
      class: "row selectable gcp-row",
      tabindex: 0,
      "data-search": [bucket.name, bucket.region].filter(Boolean).join(" "),
      "data-fav-id": bucket.name,
    },
    badge,
    h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title" }, bucket.name), sub ? h("small", {}, sub) : null),
    h("div", { class: "actions" }),
    h("span", { class: "gcp-chevron" }, icon("chevronRight"))
  );
  const open = () => {
    // Named for the bucket so the browser's breadcrumb root reads as it.
    const synthetic = { ...bucketConnection(conn, bucket.name, { region: bucket.region }), name: bucket.name };
    nav.push(bucketScreen(synthetic, { title: bucket.name, subtitle: connectionLabel(conn) }));
  };
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  return row;
}
