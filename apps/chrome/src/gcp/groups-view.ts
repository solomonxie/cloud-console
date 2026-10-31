// Instance groups: the list, and a group detail screen with its members
// (each member opens the same instance detail screen as the VM list).

import {
  getInstance,
  listGroupInstances,
  listInstanceGroups,
  zoneOfInstanceUrl,
  type GroupMember,
  type InstanceGroupSummary,
  type InstanceSummary,
} from "@cloud-console/core/gcp/compute";
import type { Screen } from "../app/nav.ts";
import { nav } from "../app/nav.ts";
import { decorateFavorites } from "../lib/favorites.ts";
import { applyFilter, filterBox } from "../ui/search.ts";
import { cachedInstances } from "./cache.ts";
import { consoleLinks } from "./console-links.ts";
import { favoritesScope, type ListResult, type ProjectContext, type ViewContext } from "./context.ts";
import { clear, emptyState, externalLink, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";
import { instanceScreen, statusPill } from "./instances-view.ts";

const MEMBER_FILTER_THRESHOLD = 8;

function sizeText(group: InstanceGroupSummary): string {
  return group.managed && group.manager?.targetSize !== undefined ? `${group.size ?? 0}/${group.manager.targetSize}` : String(group.size ?? 0);
}

export async function renderGroups(container: HTMLElement, ctx: ViewContext): Promise<ListResult | null> {
  clear(container);
  container.append(statusLine("loading", "Loading instance groups…"));
  let groups: InstanceGroupSummary[];
  try {
    groups = await listInstanceGroups(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return null;
    container.replaceChildren(statusLine("error", describeError(err, "Couldn't list instance groups")));
    return null;
  }
  if (!ctx.isCurrent()) return null;
  clear(container);
  if (!groups.length) {
    container.append(emptyState("layers", "No instance groups", "This project has no managed or unmanaged instance groups."));
    return null;
  }
  const rows = groups.map((g) => groupRow(g, ctx));
  const stats = h("div", { class: "list-stats" });
  container.append(h("div", { class: "gcp-list" }, ...rows), stats);
  return { rows, stats, noun: ["group", "groups"] };
}

function groupRow(group: InstanceGroupSummary, ctx: ViewContext): HTMLElement {
  const badge = h("span", { class: "badge" });
  badge.append(icon("layers"));
  const size = sizeText(group);
  const kind = group.managed ? "Managed" : "Unmanaged";
  const row = h(
    "div",
    {
      class: "row selectable gcp-row",
      tabindex: 0,
      "data-search": [group.name, group.location, group.locationType, kind].join(" "),
      "data-fav-id": `${group.location}/${group.name}`,
    },
    badge,
    h(
      "div",
      { class: "name gcp-two-line" },
      h("span", { class: "gcp-title" }, group.name),
      h("small", {}, `${kind} · ${group.locationType} ${group.location}`)
    ),
    h("span", { class: "meta", title: group.managed ? "Current / target size" : "Size" }, `${size} VM${size === "1" ? "" : "s"}`),
    h("div", { class: "actions" }, externalLink(consoleLinks.instanceGroup(ctx.projectId, group.location, group.name))),
    h("span", { class: "gcp-chevron" }, icon("chevronRight"))
  );
  const open = () => nav.push(groupScreen(ctx, group));
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  return row;
}

function groupScreen(ctx: ProjectContext, group: InstanceGroupSummary): Screen {
  let generation = 0;
  let body: HTMLElement;
  let fresh = false;
  let changed = false; // a member was started/stopped on its detail screen
  return {
    title: group.name,
    subtitle: `Instance group · ${ctx.projectId}`,
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail");
      header.actions.append(
        iconButton("refresh", "Refresh", () => {
          fresh = true;
          void load();
        }),
        externalLink(consoleLinks.instanceGroup(ctx.projectId, group.location, group.name))
      );
      void load();
    },
    onLeave() {
      generation++;
    },
    onShow() {
      if (!changed) return;
      changed = false;
      fresh = true;
      void load();
    },
  };

  async function load(): Promise<void> {
    const gen = ++generation;
    const isCurrent = () => gen === generation;
    const markChanged = () => {
      changed = true;
    };
    clear(body);

    const meta = h("dl", { class: "detail-meta" });
    const row = (k: string, v: string | undefined) => {
      if (v) meta.append(h("dt", {}, k), h("dd", {}, v));
    };
    row("Type", group.managed ? "Managed" : "Unmanaged");
    row("Location", `${group.location} (${group.locationType})`);
    row(group.managed ? "Size / target" : "Size", sizeText(group));
    row("Template", group.manager?.instanceTemplate?.split("/").pop());
    row("Base name", group.manager?.baseInstanceName);
    row("Named ports", group.namedPorts?.map((p) => `${p.name}:${p.port}`).join(", "));
    row("Network", group.network?.split("/").pop());
    row("Stable", group.manager?.status?.isStable === undefined ? undefined : group.manager.status.isStable ? "Yes" : "No — changes in progress");
    row("Description", group.description);

    const members = h("div", {}, statusLine("loading", "Loading members…"));
    body.append(
      h("section", { class: "gcp-detail-section" }, meta),
      h("section", { class: "gcp-detail-section" }, h("h3", {}, "Members"), members)
    );

    // Members and the project's instances in parallel: the latter fills in
    // machine type and IPs. Its failure only loses that enrichment.
    const useFresh = fresh;
    fresh = false;
    const [memberResult, instResult] = await Promise.allSettled([
      listGroupInstances(ctx.creds, ctx.projectId, group),
      cachedInstances(ctx, useFresh),
    ]);
    if (!isCurrent()) return;
    if (memberResult.status === "rejected") {
      members.replaceChildren(statusLine("error", describeError(memberResult.reason, "Couldn't list group members")));
      return;
    }
    const list = memberResult.value;
    if (!list.length) {
      members.replaceChildren(h("div", { class: "gcp-muted" }, "No instances in this group."));
      return;
    }
    const byUrl = new Map<string, InstanceSummary>();
    if (instResult.status === "fulfilled") {
      for (const inst of instResult.value) byUrl.set(`${inst.zoneName}/${inst.name}`, inst);
    }
    const rows = list.map((m) => memberRow(m, byUrl.get(`${zoneOfInstanceUrl(m.instance)}/${m.name}`), markChanged));
    const stats = h("div", { class: "list-stats" });
    const setStats = (shown: number) => {
      const n = `${list.length} member${list.length === 1 ? "" : "s"}`;
      stats.textContent = shown === list.length ? n : `${shown} of ${n}`;
    };
    setStats(list.length);
    clear(members);
    if (list.length > MEMBER_FILTER_THRESHOLD) {
      members.append(filterBox("Filter members", (q) => setStats(applyFilter(rows, q))));
    }
    if (instResult.status === "rejected") {
      members.append(statusLine("info", describeError(instResult.reason, "Machine types and IPs unavailable")));
    }
    members.append(h("div", { class: "gcp-list" }, ...rows), stats);
    // Same favorites as the VM list, so a starred VM is pinned in both.
    void decorateFavorites(favoritesScope(ctx, "gceInstances"), rows);
  }

  function memberRow(m: GroupMember, inst: InstanceSummary | undefined, markChanged: () => void): HTMLElement {
    const zone = zoneOfInstanceUrl(m.instance);
    const ips = [inst?.internalIp, inst?.externalIp].filter(Boolean).join(" · ");
    const sub = [zone, inst?.machineTypeName, ips].filter(Boolean).join(" · ");
    const action = m.currentAction && m.currentAction !== "NONE" ? m.currentAction.toLowerCase() : "";
    const badge = h("span", { class: "badge" });
    badge.append(icon("server"));
    const row = h(
      "div",
      {
        class: `row gcp-row gcp-member-row ${zone ? "selectable" : ""}`.trim(),
        tabindex: zone ? 0 : -1,
        "data-search": [m.name, zone, m.status, action, inst?.machineTypeName, inst?.internalIp, inst?.externalIp].join(" "),
        "data-fav-id": zone ? `${zone}/${m.name}` : undefined,
      },
      badge,
      h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title" }, m.name), h("small", {}, sub)),
      action ? h("span", { class: "gcp-pill busy", title: "Current action" }, action) : null,
      statusPill(m.status ?? inst?.status),
      zone ? h("div", { class: "actions" }, externalLink(consoleLinks.instance(ctx.projectId, zone, m.name))) : null
    );
    // The detail screen needs the full instance: take it from the project
    // list, or fetch it when the list didn't have it (e.g. just created).
    if (zone) {
      const open = async () => {
        if (inst) return nav.push(instanceScreen(ctx, inst, markChanged));
        row.classList.add("busy");
        try {
          const full = await getInstance(ctx.creds, ctx.projectId, zone, m.name);
          nav.push(instanceScreen(ctx, full, markChanged));
        } catch (err) {
          row.title = describeError(err, "Couldn't open this instance");
          row.classList.add("gcp-row-error");
        } finally {
          row.classList.remove("busy");
        }
      };
      row.addEventListener("click", () => void open());
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void open();
      });
    }
    return row;
  }
}
