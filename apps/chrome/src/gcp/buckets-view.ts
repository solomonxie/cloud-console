// Cloud Storage: the project's buckets; tapping one opens the shared bucket
// browser with this account's credentials (a synthetic, unsaved connection).

import { listBuckets, type GcsBucket } from "@cloud-console/core/gcp/buckets";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { nav } from "../app/nav.ts";
import { bucketScreen } from "../sidepanel/bucket-screen.ts";
import { consoleLinks } from "./console-links.ts";
import type { ListResult, ViewContext } from "./context.ts";
import { clear, emptyState, externalLink, formatTime, h, icon, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";

export async function renderBuckets(container: HTMLElement, ctx: ViewContext, credentialsJson: string): Promise<ListResult | null> {
  clear(container);
  container.append(statusLine("loading", "Loading buckets…"));
  let buckets: GcsBucket[];
  try {
    buckets = await listBuckets(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return null;
    container.replaceChildren(statusLine("error", describeError(err, "Couldn't list buckets")));
    return null;
  }
  if (!ctx.isCurrent()) return null;
  clear(container);
  if (!buckets.length) {
    container.append(emptyState("database", "No buckets", "This project has no Cloud Storage buckets this credential can see."));
    return null;
  }
  const rows = buckets.map((b) => bucketRow(b, ctx, credentialsJson));
  const stats = h("div", { class: "list-stats" });
  container.append(h("div", { class: "gcp-list" }, ...rows), stats);
  return { rows, stats, noun: ["bucket", "buckets"] };
}

function bucketRow(bucket: GcsBucket, ctx: ViewContext, credentialsJson: string): HTMLElement {
  const badge = h("span", { class: "badge folder" });
  badge.append(icon("database"));
  const location = [bucket.location?.toLowerCase(), bucket.locationType].filter(Boolean).join(" ");
  const sub = [location, bucket.storageClass?.toLowerCase(), bucket.timeCreated ? `created ${formatTime(bucket.timeCreated)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const row = h(
    "div",
    {
      class: "row selectable gcp-row",
      tabindex: 0,
      "data-search": [bucket.name, bucket.location, bucket.locationType, bucket.storageClass].join(" "),
      "data-fav-id": bucket.name,
    },
    badge,
    h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title" }, bucket.name), h("small", {}, sub)),
    h("div", { class: "actions" }, externalLink(consoleLinks.bucket(ctx.projectId, bucket.name))),
    h("span", { class: "gcp-chevron" }, icon("chevronRight"))
  );
  const open = () => {
    // Never saved: it lives only as long as the bucket screen.
    const conn: StorageConnection = {
      id: `gcp:${ctx.accountId}:${bucket.name}`,
      type: "gcs",
      name: bucket.name,
      bucket: bucket.name,
      serviceAccountJson: credentialsJson,
    };
    nav.push(bucketScreen(conn, { title: bucket.name, subtitle: ctx.projectId }));
  };
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  return row;
}
