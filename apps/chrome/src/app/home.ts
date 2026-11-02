// Home: one floating card per connection, any vendor, like the mobile app's
// Home — its selected resources as rows, each pushing that resource's screen.
// Storage connections (vendor + key) and Google Cloud accounts live in
// separate stores; both are listed here, in that order.
import type { VendorId } from "@cloud-console/core/catalog";
import { bucketConnection, connectionLabel, STORAGE_TYPE_NAME, storageTypeForVendor, type StorageConnection } from "@cloud-console/core/storage/connection";
import { getAccounts, type GcpAccount } from "../gcp/accounts.ts";
import { primeLinkedFile } from "../gcp/credentials-file.ts";
import { h } from "../gcp/dom.ts";
import { kindScreen } from "./kind-screens.ts";
import { gcpHomeKinds, gcpResourceScreen, openGcpAccountDialog, type GcpKind } from "../gcp/screens.ts";
import { favoriteButton, loadFavorites, pinFavorites } from "../lib/favorites.ts";
import { icon } from "../lib/icons.ts";
import { getConnections } from "../lib/store.ts";
import { bucketScreen } from "../sidepanel/bucket-screen.ts";
import { exportAllConnections, importConnectionsFile, openConnectionModal } from "../sidepanel/connections.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import { bucketsScreen } from "./buckets-screen.ts";
import { nav, type Screen } from "./nav.ts";
import { chromeVendors, KIND_ICON, selectedKinds, storageKinds, storageVendor, VENDOR_ACCENT, VENDOR_NAME } from "./vendors.ts";

// Favorites scope for connection cards (ids: connection / account ids).
const HOME_FAVORITES = "home";

// Show the filter box once the list is long enough to need it.
const FILTER_THRESHOLD = 5;

// One line under each vendor in the "+" chooser: what a connection shows.
const VENDOR_DETAIL: Partial<Record<VendorId, string>> = {
  aws: "S3 buckets",
  gcp: "Cloud Storage, VMs, Cloud Run, secrets…",
  azure: "Blob containers",
  alibaba: "OSS buckets",
  tencent: "COS, CVM, CAM, EventBridge, billing",
  s3compat: "Cloudflare R2, MinIO…",
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

// Cards start collapsed to their header (a long list of connections stays
// scannable); clicking the header shows that connection's resource rows.
// Which cards are open is remembered on this device.
const EXPANDED_KEY = "homeExpanded";
let expanded = new Set<string>();

async function loadExpanded(): Promise<void> {
  const got = await chrome.storage.local.get(EXPANDED_KEY).catch(() => ({}) as Record<string, unknown>);
  const ids = (got as Record<string, unknown>)[EXPANDED_KEY];
  expanded = new Set(Array.isArray(ids) ? (ids as string[]) : []);
}

function saveExpanded(): void {
  void chrome.storage.local.set({ [EXPANDED_KEY]: [...expanded] }).catch(() => undefined);
}

function card(opts: { id: string; accent: string; name: string; subtitle: string; search: string; onEdit: () => void; rows: HTMLElement[] }): HTMLElement {
  const n = opts.rows.length;
  const count = h("span", { class: "conn-card-count" }, `${n} resource${n === 1 ? "" : "s"}`);
  const toggle = h("span", { class: "conn-card-toggle" }, svg("chevronRight"));
  const rows = h("div", { class: "conn-card-rows", id: `rows-${opts.id}` }, ...opts.rows);
  const head = h(
    "header",
    { class: "conn-card-head", role: "button", tabindex: 0, "aria-controls": rows.id },
    vendorBadge(opts.accent),
    h(
      "div",
      { class: "conn-card-titles" },
      h("div", { class: "conn-card-name", title: opts.name }, opts.name),
      h("div", { class: "conn-card-sub" }, opts.subtitle, " · ", count)
    ),
    iconBtn("settings", `Edit ${opts.name}`, opts.onEdit),
    toggle
  );
  const el = h("article", { class: "conn-card", "data-search": opts.search, "data-fav-id": opts.id }, head, rows);
  const set = (open: boolean) => {
    el.classList.toggle("open", open);
    rows.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
  };
  set(expanded.has(opts.id));
  const flip = () => {
    const open = !el.classList.contains("open");
    if (open) expanded.add(opts.id);
    else expanded.delete(opts.id);
    saveExpanded();
    set(open);
  };
  // The header's own buttons (edit, star) stop propagation.
  head.addEventListener("click", flip);
  head.addEventListener("keydown", (e) => {
    if (e.target !== head || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    flip();
  });
  return el;
}

// A storage connection's bucket row: straight into the bucket when the
// connection is limited to one (its prefix the hard root), else the list of
// every bucket the key can see.
function openStorage(conn: StorageConnection): void {
  const scope = conn.storageScope;
  const label = connectionLabel(conn);
  if (scope?.bucket) {
    const synthetic = bucketConnection(conn, scope.bucket, { prefix: scope.prefix });
    nav.push(bucketScreen(synthetic, { title: label, subtitle: label !== scope.bucket ? scope.bucket : undefined }));
  } else {
    nav.push(bucketsScreen(conn, label));
  }
}

function storageCard(conn: StorageConnection): HTMLElement {
  const vendor = storageVendor(conn);
  const accent = VENDOR_ACCENT[vendor];
  const typeName = STORAGE_TYPE_NAME[conn.type] ?? VENDOR_NAME[vendor];
  const subtitle = conn.type === "s3-compat" && conn.endpoint ? `${typeName} · ${conn.endpoint}` : typeName;
  const scope = conn.storageScope;
  const kinds = selectedKinds(storageKinds(conn.type), conn.resources);
  return card({
    id: conn.id,
    accent,
    name: connectionLabel(conn),
    subtitle,
    search: [conn.name, typeName, VENDOR_NAME[vendor], scope?.bucket, scope?.prefix, conn.endpoint, ...kinds.map((k) => k.title)].filter(Boolean).join(" "),
    onEdit: () => void openConnectionModal(conn),
    rows: kinds.map((k) => {
      const factory = kindScreen(vendor, k.id);
      if (factory) return resourceRow(KIND_ICON[k.id] ?? "file", accent, k.title, undefined, () => nav.push(factory(conn)));
      const detail = scope?.bucket ? `${scope.bucket}${scope.prefix ? `/${scope.prefix}` : ""}` : undefined;
      return resourceRow(KIND_ICON[k.id] ?? "bucket", accent, k.title, detail, () => openStorage(conn));
    }),
  });
}

function gcpCard(account: GcpAccount): HTMLElement {
  const accent = VENDOR_ACCENT.gcp;
  const kinds = selectedKinds(gcpHomeKinds(), account.resources);
  return card({
    id: account.id,
    accent,
    name: account.name,
    subtitle: "Google Cloud",
    search: [account.name, "Google Cloud GCP", ...kinds.map((k) => k.title)].join(" "),
    onEdit: () => openGcpAccountDialog(account, () => nav.home()),
    rows: kinds.map((k) => {
      const kind = k.id as GcpKind;
      return resourceRow(KIND_ICON[kind] ?? "file", accent, k.title, undefined, () => {
        primeLinkedFile(account); // inside the click, so Chrome may prompt
        nav.push(gcpResourceScreen(account, kind));
      });
    }),
  });
}

// "+": which cloud vendor to connect — only vendors with an implemented
// Chrome resource kind (catalog-driven). Google Cloud gets its account
// dialog; the rest the storage connection form for that vendor.
function openAddChooser(): void {
  const dialog = h("dialog", { class: "alert-dialog add-chooser" });
  const choose = (fn: () => void) => () => {
    dialog.close();
    fn();
  };
  const option = (iconName: string, accent: string, title: string, detail: string, onPick: () => void) => {
    const badge = h("span", { class: "kind-badge" }, svg(iconName));
    badge.style.setProperty("--vendor", accent);
    return h(
      "button",
      { type: "button", class: "card-row", onclick: choose(onPick) },
      badge,
      h("span", { class: "card-row-label" }, h("span", {}, title), h("small", {}, detail)),
      h("span", { class: "chevron" }, svg("chevronRight"))
    );
  };
  dialog.append(
    h("h2", {}, "Add connection"),
    h(
      "div",
      { class: "chooser-options" },
      ...chromeVendors().map((v) =>
        option("cloud", VENDOR_ACCENT[v.id], VENDOR_NAME[v.id], VENDOR_DETAIL[v.id] ?? "", () =>
          v.id === "gcp" ? openGcpAccountDialog(undefined, () => nav.home()) : void openConnectionModal(null, storageTypeForVendor(v.id))
        )
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
          loadExpanded(),
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
              h("div", {}, "A cloud vendor's access key — this panel only does what that key can do."),
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
