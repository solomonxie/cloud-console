import {
  listGroupInstances,
  listInstanceGroups,
  zoneOfInstanceUrl,
  type InstanceGroupSummary,
} from "@cloud-console/core/gcp/compute";
import { consoleLinks } from "./console-links.ts";
import type { ViewContext } from "./context.ts";
import { clear, emptyState, externalLink, h, icon, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";
import { statusPill } from "./instances-view.ts";

export async function renderGroups(container: HTMLElement, ctx: ViewContext): Promise<void> {
  clear(container);
  container.append(statusLine("loading", "Loading instance groups…"));
  let groups: InstanceGroupSummary[];
  try {
    groups = await listInstanceGroups(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    clear(container);
    container.append(statusLine("error", describeError(err, "Couldn't list instance groups")));
    return;
  }
  if (!ctx.isCurrent()) return;
  clear(container);
  if (!groups.length) {
    container.append(emptyState("layers", "No instance groups", "This project has no managed or unmanaged instance groups."));
    return;
  }
  const list = h("div", { class: "gcp-list" });
  for (const g of groups) list.append(groupRow(g, ctx));
  container.append(list, h("div", { class: "list-stats" }, `${groups.length} group${groups.length === 1 ? "" : "s"}`));
}

function groupRow(group: InstanceGroupSummary, ctx: ViewContext): HTMLElement {
  const wrap = h("div", { class: "gcp-group" });
  const chevron = h("span", { class: "gcp-chevron" });
  chevron.append(icon("chevronRight"));
  const badge = h("span", { class: "badge" });
  badge.append(icon("layers"));
  const size = group.managed && group.manager?.targetSize !== undefined
    ? `${group.size ?? 0}/${group.manager.targetSize}`
    : String(group.size ?? 0);
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0, "aria-expanded": "false" },
    chevron,
    badge,
    h(
      "div",
      { class: "name gcp-two-line" },
      h("span", { class: "gcp-title" }, group.name),
      h("small", {}, `${group.managed ? "Managed" : "Unmanaged"} · ${group.locationType} ${group.location}`)
    ),
    h("span", { class: "meta", title: group.managed ? "Current / target size" : "Size" }, `${size} VM${size === "1" ? "" : "s"}`),
    h("div", { class: "actions" }, externalLink(consoleLinks.instanceGroup(ctx.projectId, group.location, group.name)))
  );
  const members = h("div", { class: "gcp-members", hidden: true });
  let loaded = false;
  const toggle = () => {
    const open = members.hidden !== false;
    members.hidden = !open;
    row.setAttribute("aria-expanded", String(open));
    wrap.classList.toggle("open", open);
    if (open && !loaded) {
      loaded = true;
      void loadMembers(members, group, ctx);
    }
  };
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") toggle();
  });
  wrap.append(row, members);
  return wrap;
}

async function loadMembers(container: HTMLElement, group: InstanceGroupSummary, ctx: ViewContext): Promise<void> {
  container.replaceChildren(statusLine("loading", "Loading members…"));
  try {
    const members = await listGroupInstances(ctx.creds, ctx.projectId, group);
    clear(container);
    if (!members.length) {
      container.append(h("div", { class: "gcp-member muted" }, "No instances in this group."));
      return;
    }
    for (const m of members) {
      const zone = zoneOfInstanceUrl(m.instance);
      container.append(
        h(
          "div",
          { class: "gcp-member" },
          h("span", { class: "name" }, m.name),
          h("small", { class: "meta" }, zone),
          m.currentAction && m.currentAction !== "NONE" ? h("span", { class: "gcp-pill busy" }, m.currentAction.toLowerCase()) : null,
          m.status ? statusPill(m.status) : null,
          zone ? externalLink(consoleLinks.instance(ctx.projectId, zone, m.name)) : null
        )
      );
    }
  } catch (err) {
    container.replaceChildren(statusLine("error", describeError(err, "Couldn't list group members")));
  }
}
