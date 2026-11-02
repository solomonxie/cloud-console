// Cloud Storage: the project's buckets; tapping one opens the shared bucket
// browser with this account's credentials (a synthetic, unsaved connection).

import { listBuckets, type GcsBucket } from "@cloud-console/core/gcp/buckets";
import { GcpApiError } from "@cloud-console/core/gcp/request";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { nav } from "../app/nav.ts";
import { bucketScreen } from "../sidepanel/bucket-screen.ts";
import { consoleLinks } from "./console-links.ts";
import type { ListResult, ViewContext } from "./context.ts";
import { clear, emptyState, externalLink, formatTime, h, icon, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";
import { favoriteButton, loadFavorites } from "../lib/favorites.ts";

// Buckets/folders starred from the bucket screen, per account (not per
// project: a customer's bucket belongs to none of ours). Ids are gs:// URIs;
// the Cloud Storage screen lists them above everything else.
export function pinnedPathsScope(accountId: string): string {
  return `gcp:${accountId}:gcsPaths`;
}

export function gcsUri(bucket: string, prefix: string): string {
  return `gs://${bucket}/${prefix}`;
}

// Opens the shared bucket browser with this account's credentials. Never
// saved: the synthetic connection lives only as long as the bucket screen.
// A prefix is the hard root of browsing (e.g. a partner's folder-only grant).
// The header star pins the bucket/folder being shown (it follows browsing)
// to the top of Cloud Storage.
export function openGcsBucket(accountId: string, credentialsJson: string, bucket: string, prefix: string, subtitle?: string): void {
  const conn: StorageConnection = {
    id: `gcp:${accountId}:${bucket}`,
    type: "gcs",
    name: bucket,
    bucket,
    ...(prefix ? { prefix } : {}),
    serviceAccountJson: credentialsJson,
  };
  const scope = pinnedPathsScope(accountId);
  const actions = async (current: string) => [
    favoriteButton(scope, gcsUri(bucket, current), await loadFavorites(scope), () => undefined),
  ];
  nav.push(bucketScreen(conn, { title: prefix ? `${bucket}/${prefix}` : bucket, subtitle, actions }));
}

// The starred paths as rows (star to unpin, click to open); null when none.
export async function pinnedPathsList(accountId: string, open: (bucket: string, prefix: string) => void): Promise<HTMLElement | null> {
  const scope = pinnedPathsScope(accountId);
  const favs = await loadFavorites(scope);
  const uris = [...favs].sort();
  if (!uris.length) return null;
  const list = h("div", { class: "gcp-list gcp-pinned-paths" });
  for (const uri of uris) {
    const path = parseGcsPath(uri);
    if (!path) continue;
    const badge = h("span", { class: "badge folder" });
    badge.append(icon(path.prefix ? "folder" : "database"));
    const row = h(
      "div",
      { class: "row selectable gcp-row", tabindex: 0, "data-search": uri },
      badge,
      h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title" }, path.prefix ? `${path.bucket}/${path.prefix}` : path.bucket), h("small", {}, "pinned")),
      h("div", { class: "actions" }, favoriteButton(scope, uri, favs, () => row.remove())),
      h("span", { class: "gcp-chevron" }, icon("chevronRight"))
    );
    row.addEventListener("click", () => open(path.bucket, path.prefix));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open(path.bucket, path.prefix);
    });
    list.append(row);
  }
  return list;
}

// "gs://bucket/folder/" (or "bucket/folder") → bucket + prefix ending in "/".
export function parseGcsPath(input: string): { bucket: string; prefix: string } | null {
  const path = input.trim().replace(/^gs:\/\//, "");
  const [bucket, ...rest] = path.split("/");
  if (!bucket || !/^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$/.test(bucket)) return null;
  const prefix = rest.filter(Boolean).join("/");
  return { bucket, prefix: prefix ? `${prefix}/` : "" };
}

export async function renderBuckets(container: HTMLElement, ctx: ViewContext, credentialsJson: string): Promise<ListResult | null> {
  clear(container);
  container.append(statusLine("loading", "Loading buckets…"));
  let buckets: GcsBucket[];
  try {
    buckets = await listBuckets(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return null;
    // Missing storage.buckets.list is normal for an account that only has
    // access to particular buckets: say so calmly, not as a failure.
    container.replaceChildren(
      err instanceof GcpApiError && err.isPermissionDenied
        ? emptyState("database", "Can't list this project's buckets", "This account can't list buckets here (no storage.buckets.list). Buckets it can open still work — type gs://bucket/ above, or pick another project.")
        : statusLine("error", describeError(err, "Couldn't list buckets"))
    );
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
  const open = () => openGcsBucket(ctx.accountId, credentialsJson, bucket.name, "", ctx.projectId);
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  return row;
}
