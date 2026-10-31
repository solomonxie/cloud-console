// Home: one floating card per connection, any vendor, like the mobile app's
// Home — its resources as rows, each pushing that resource's screen.
// Storage connections (one bucket each) and Google Cloud accounts live in
// separate stores; both are listed here, in that order.
import { resourceKinds, type VendorId } from "@cloud-console/core/catalog";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import type { StorageType } from "@cloud-console/core/storage/types";
import { getAccounts, type GcpAccount } from "../gcp/accounts.ts";
import { h } from "../gcp/dom.ts";
import { gcpResourceScreen, openGcpAccountDialog, type GcpKind } from "../gcp/screens.ts";
import { favoriteButton, loadFavorites, pinFavorites } from "../lib/favorites.ts";
import { icon } from "../lib/icons.ts";
import { getConnections } from "../lib/store.ts";
import { bucketScreen } from "../sidepanel/bucket-screen.ts";
import { exportAllConnections, importConnectionsFile, openConnectionModal } from "../sidepanel/connections.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import { nav, type Screen } from "./nav.ts";

// Favorites scope for connection cards (ids: connection / account ids).
const HOME_FAVORITES = "home";

// Show the filter box once the list is long enough to need it.
const FILTER_THRESHOLD = 5;

// Same accents as the mobile app (apps/mobile/src/theme.ts VENDOR_ACCENT).
const VENDOR_ACCENT: Record<VendorId, string> = {
  aws: "#FF9500",
  azure: "#007AFF",
  gcp: "#FF3B30",
  tencent: "#30B0C7",
  alibaba: "#FF2D55",
};
const NEUTRAL_ACCENT = "#8E8E93";

const STORAGE_VENDOR: Record<StorageType, { vendor?: VendorId; name: string }> = {
  s3: { vendor: "aws", name: "AWS S3" },
  "s3-compat": { name: "S3-compatible" },
  azure: { vendor: "azure", name: "Azure Blob Storage" },
  gcs: { vendor: "gcp", name: "Google Cloud Storage" },
  "tencent-cos": { vendor: "tencent", name: "Tencent Cloud COS" },
  "alibaba-oss": { vendor: "alibaba", name: "Alibaba Cloud OSS" },
};

const KIND_ICON: Record<GcpKind, string> = {
  gcs: "bucket",
  gceInstances: "server",
  gceInstanceGroups: "layers",
  gcpSecrets: "key",
};

// lib/icons.ts returns markup; wrap it as a node for h().
function svg(name: string): Element {
  const t = document.createElement("template");
  t.innerHTML = icon(name);
  return t.content.firstElementChild!;
}

function iconBtn(name: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = h("button", { type: "button", class: "icon-btn", title, "aria-label": title }, svg(name));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function vendorBadge(accent: string, iconName = "cloud"): HTMLElement {
  const badge = h("span", { class: "vendor-badge" }, svg(iconName));
  badge.style.setProperty("--vendor", accent);
  return badge;
}

function resourceRow(iconName: string, accent: string, label: string, detail: string | undefined, onOpen: () => void): HTMLElement {
  const badge = h("span", { class: "kind-badge" }, svg(iconName));
  badge.style.setProperty("--vendor", accent);
  return h(
    "button",
    { type: "button", class: "card-row", onclick: onOpen },
    badge,
    h("span", { class: "card-row-label" }, h("span", {}, label), detail ? h("small", {}, detail) : null),
    h("span", { class: "chevron" }, svg("chevronRight"))
  );
}

function card(opts: { id: string; accent: string; name: string; subtitle: string; search: string; onEdit: () => void; rows: HTMLElement[] }): HTMLElement {
  const el = h(
    "article",
    { class: "conn-card", "data-search": opts.search, "data-fav-id": opts.id },
    h(
      "header",
      { class: "conn-card-head" },
      vendorBadge(opts.accent),
      h("div", { class: "conn-card-titles" }, h("div", { class: "conn-card-name", title: opts.name }, opts.name), h("div", { class: "conn-card-sub" }, opts.subtitle)),
      iconBtn("settings", `Edit ${opts.name}`, opts.onEdit)
    ),
    ...opts.rows
  );
  return el;
}

function storageCard(conn: StorageConnection): HTMLElement {
  const meta = STORAGE_VENDOR[conn.type] ?? STORAGE_VENDOR.s3;
  const accent = meta.vendor ? VENDOR_ACCENT[meta.vendor] : NEUTRAL_ACCENT;
  const subtitle = conn.type === "s3-compat" && conn.endpoint ? `${meta.name} · ${conn.endpoint}` : meta.name;
  return card({
    id: conn.id,
    accent,
    name: conn.name || conn.bucket,
    subtitle,
    search: [conn.name, meta.name, conn.bucket, conn.prefix, conn.endpoint].filter(Boolean).join(" "),
    onEdit: () => openConnectionModal(conn),
    rows: [resourceRow("bucket", accent, conn.bucket || "(no bucket)", conn.prefix || undefined, () => nav.push(bucketScreen(conn)))],
  });
}

function gcpCard(account: GcpAccount): HTMLElement {
  const accent = VENDOR_ACCENT.gcp;
  const kinds = resourceKinds("gcp", "chrome").filter((k) => k.id !== "gcpProjects");
  return card({
    id: account.id,
    accent,
    name: account.name,
    subtitle: "Google Cloud",
    search: [account.name, "Google Cloud GCP", ...kinds.map((k) => k.title)].join(" "),
    onEdit: () => openGcpAccountDialog(account, () => nav.home()),
    rows: kinds.map((k) => {
      const kind = k.id as GcpKind;
      return resourceRow(KIND_ICON[kind] ?? "file", accent, k.title, undefined, () => nav.push(gcpResourceScreen(account, kind)));
    }),
  });
}

// "+": what kind of connection to add.
function openAddChooser(): void {
  const dialog = h("dialog", { class: "alert-dialog add-chooser" });
  const choose = (fn: () => void) => () => {
    dialog.close();
    fn();
  };
  const option = (iconName: string, title: string, detail: string, onPick: () => void) =>
    h(
      "button",
      { type: "button", class: "card-row", onclick: choose(onPick) },
      h("span", { class: "kind-badge" }, svg(iconName)),
      h("span", { class: "card-row-label" }, h("span", {}, title), h("small", {}, detail)),
      h("span", { class: "chevron" }, svg("chevronRight"))
    );
  dialog.append(
    h("h2", {}, "Add connection"),
    h(
      "div",
      { class: "chooser-options" },
      option("bucket", "Storage bucket", "S3, R2, Azure, GCS, COS, OSS", () => openConnectionModal(null)),
      option("cloud", "Google Cloud account", "Cloud Storage, VMs, instance groups, secrets", () =>
        openGcpAccountDialog(undefined, () => nav.home())
      )
    ),
    h("div", { class: "modal-actions" }, h("span", { class: "spacer" }), h("button", { type: "button", class: "btn", onclick: () => dialog.close() }, "Cancel"))
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // backdrop
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}

function statusLine(message: string, error = false): HTMLElement {
  return h("div", { class: `status${error ? " error" : ""}` }, svg(error ? "alertCircle" : "inbox"), h("span", {}, message));
}

export function homeScreen(): Screen {
  return {
    title: "Cloud Console",
    async render(body, header) {
      body.classList.add("home-screen");
      const status = h("div", { class: "home-status" });
      const list = h("div", { class: "home-list" });
      body.append(status, list);

      const importInput = h("input", { type: "file", accept: "application/json", hidden: true });
      importInput.addEventListener("change", async () => {
        const file = importInput.files?.[0];
        importInput.value = "";
        if (!file) return;
        try {
          const n = await importConnectionsFile(file);
          await load();
          status.replaceChildren(statusLine(`Imported ${n} connection${n === 1 ? "" : "s"}.`));
        } catch (err) {
          status.replaceChildren(statusLine((err as Error)?.message || String(err), true));
        }
      });
      header.actions.append(
        iconBtn("plus", "Add connection", openAddChooser),
        iconBtn("share", "Export storage connections", () => void exportAllConnections()),
        iconBtn("import", "Import storage connections", () => importInput.click()),
        importInput
      );

      const load = async () => {
        const [connections, accounts, favs] = await Promise.all([
          getConnections(),
          getAccounts(),
          loadFavorites(HOME_FAVORITES).catch(() => new Set<string>()),
        ]);
        status.replaceChildren();
        const cards = [...connections.map(storageCard), ...accounts.map(gcpCard)];
        if (!cards.length) {
          const add = h("button", { type: "button", class: "btn primary", onclick: openAddChooser }, svg("plus"), "Add connection");
          list.replaceChildren(
            h(
              "div",
              { class: "empty-state" },
              svg("cloud"),
              h("div", { class: "primary" }, "Add a connection to get started"),
              h("div", {}, "A storage bucket's keys or a Google Cloud credential — this panel only does what that key can do."),
              add
            )
          );
          return;
        }
        const empty = h("div", { class: "empty-state", hidden: true }, svg("search"), h("div", { class: "primary" }, "No matches"));
        const filter =
          cards.length > FILTER_THRESHOLD
            ? filterBox("Filter connections", (q) => {
                empty.hidden = applyFilter(cards, q) > 0;
              })
            : null;
        list.replaceChildren(...(filter ? [filter] : []), ...cards, empty);
        // Starred connections first; a star in each card's header.
        const repin = () => pinFavorites(list, cards, favs);
        for (const c of cards) {
          const settings = c.querySelector(".conn-card-head > .icon-btn");
          settings?.before(favoriteButton(HOME_FAVORITES, c.dataset.favId ?? "", favs, repin));
        }
        repin();
      };
      await load();
    },
  };
}
