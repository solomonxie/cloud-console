// VM instances: the list (rows filtered by the resource screen) and the
// instance detail screen pushed when a row is tapped.

import {
  getDisk,
  getInstance,
  getMachineType,
  getSerialPortOutput,
  instanceAction,
  type AttachedDisk,
  type DiskSummary,
  type InstanceAction,
  type InstanceSummary,
  type MachineType,
} from "@cloud-console/core/gcp/compute";
import type { Screen } from "../app/nav.ts";
import { nav } from "../app/nav.ts";
import { cachedInstances } from "./cache.ts";
import { consoleLinks } from "./console-links.ts";
import type { ListResult, ProjectContext, ViewContext } from "./context.ts";
import { clear, confirmDialog, emptyState, externalLink, formatTime, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";
import { renderUsage } from "./usage.ts";

const TRANSITIONAL = new Set(["PROVISIONING", "STAGING", "STOPPING", "SUSPENDING", "REPAIRING"]);

export function statusPill(status: string | undefined): HTMLElement {
  const s = status ?? "UNKNOWN";
  const tone =
    s === "RUNNING" ? "ok" : s === "TERMINATED" || s === "STOPPED" || s === "SUSPENDED" ? "off" : TRANSITIONAL.has(s) ? "busy" : "muted";
  return h("span", { class: `gcp-pill ${tone}` }, s.toLowerCase());
}

function lastSegment(url: string | undefined): string {
  return url ? url.split("/").pop() ?? "" : "";
}

function labelText(labels: Record<string, string> | undefined): string {
  return labels ? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(", ") : "";
}

// Searchable text of an instance row.
export function instanceSearchText(inst: InstanceSummary): string {
  return [inst.name, inst.zoneName, inst.machineTypeName, inst.internalIp, inst.externalIp, inst.status, labelText(inst.labels)].join(" ");
}

export async function renderInstances(container: HTMLElement, ctx: ViewContext): Promise<ListResult | null> {
  clear(container);
  container.append(statusLine("loading", "Loading VM instances…"));
  let instances: InstanceSummary[];
  try {
    instances = await cachedInstances(ctx, ctx.fresh);
  } catch (err) {
    if (!ctx.isCurrent()) return null;
    container.replaceChildren(statusLine("error", describeError(err, "Couldn't list VM instances")));
    return null;
  }
  if (!ctx.isCurrent()) return null;
  clear(container);
  if (!instances.length) {
    container.append(emptyState("server", "No VM instances", "This project has no Compute Engine instances."));
    return null;
  }
  const rows = instances.map((inst) => instanceRow(inst, ctx));
  const stats = h("div", { class: "list-stats" });
  container.append(h("div", { class: "gcp-list" }, ...rows), stats);
  return { rows, stats, noun: ["instance", "instances"] };
}

function instanceRow(inst: InstanceSummary, ctx: ViewContext): HTMLElement {
  const badge = h("span", { class: "badge" });
  badge.append(icon("server"));
  const ips = [inst.internalIp, inst.externalIp].filter(Boolean).join(" · ");
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0, "data-search": instanceSearchText(inst), "data-fav-id": `${inst.zoneName}/${inst.name}` },
    badge,
    h(
      "div",
      { class: "name gcp-two-line" },
      h("span", { class: "gcp-title" }, inst.name),
      h("small", {}, `${inst.zoneName} · ${inst.machineTypeName}${ips ? ` · ${ips}` : ""}`)
    ),
    statusPill(inst.status),
    h("div", { class: "actions" }, externalLink(consoleLinks.instance(ctx.projectId, inst.zoneName, inst.name)))
  );
  const open = () => nav.push(instanceScreen(ctx, inst, ctx.markChanged));
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  return row;
}

const ACTION_COPY: Record<InstanceAction, { label: string; verb: string; message: string; danger: boolean }> = {
  start: { label: "Start", verb: "Starting", message: "Start this VM? A running VM is billed for compute.", danger: false },
  stop: { label: "Stop", verb: "Stopping", message: "Stop this VM? Anything running on it shuts down; ephemeral data on local SSDs is lost.", danger: true },
  reset: { label: "Reset", verb: "Resetting", message: "Hard-reset this VM? It's like pressing the reset button — no clean shutdown.", danger: true },
};

function formatMemory(mb: number): string {
  const gb = mb / 1024;
  return gb >= 1 ? `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB` : `${mb} MB`;
}

// "2 vCPU (shared) · 4 GB"
function machineSummary(mt: MachineType): string {
  const cpu = `${mt.guestCpus} vCPU${mt.isSharedCpu ? " (shared)" : ""}`;
  return `${cpu} · ${formatMemory(mt.memoryMb)}`;
}

// The instance detail page. `initial` may be a list row (full instance) —
// it's re-fetched on refresh. `onChanged` tells the list to reload when the
// user goes back after a start/stop/reset.
export function instanceScreen(ctx: ProjectContext, initial: InstanceSummary, onChanged?: () => void): Screen {
  let inst = initial;
  let generation = 0;
  let body: HTMLElement;
  const status = h("div", { class: "gcp-detail-status" });

  return {
    title: initial.name,
    subtitle: `${initial.zoneName} · ${ctx.projectId}`,
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail");
      header.actions.append(
        iconButton("refresh", "Refresh", () => void refresh()),
        externalLink(consoleLinks.instance(ctx.projectId, inst.zoneName, inst.name))
      );
      render();
    },
    onLeave() {
      generation++;
    },
  };

  function render(): void {
    const gen = ++generation;
    const isCurrent = () => gen === generation;
    clear(body);

    const head = h(
      "div",
      { class: "gcp-detail-head" },
      statusPill(inst.status),
      h("span", { class: "gcp-detail-machine" }, inst.machineTypeName),
      h("span", { class: "spacer" }),
      ...actionButtons()
    );
    const spec = h("div", { class: "gcp-spec" }, specItem("cpu", "Machine", inst.machineTypeName, "Loading…"));
    void loadMachine(spec, isCurrent);

    const meta = h("dl", { class: "detail-meta" });
    const row = (k: string, v: Node | string | undefined) => {
      if (v === undefined || v === "") return;
      meta.append(h("dt", {}, k), h("dd", {}, v));
    };
    row("Zone", inst.zoneName);
    row("CPU platform", inst.cpuPlatform);
    row("Service account", inst.serviceAccounts?.map((s) => s.email).join(", "));
    row("Provisioning", inst.scheduling?.provisioningModel ?? (inst.scheduling?.preemptible ? "PREEMPTIBLE" : undefined));
    row("Deletion protection", inst.deletionProtection ? "On" : "Off");
    row("Labels", labelText(inst.labels));
    row("Network tags", inst.tags?.items?.join(", "));
    row("Created", formatTime(inst.creationTimestamp));
    row("Last started", formatTime(inst.lastStartTimestamp));
    row("Last stopped", formatTime(inst.lastStopTimestamp));
    row("Status message", inst.statusMessage);
    row("Description", inst.description);

    const disks = h("div", { class: "gcp-cards" });
    void loadDisks(disks, isCurrent);

    const usage = h("div", {}, statusLine("loading", "Loading usage…"));
    void renderUsage(usage, ctx, inst.id, isCurrent);

    const serial = h("details", { class: "gcp-serial" }, h("summary", {}, "Serial port output"));
    let loaded = false;
    serial.addEventListener("toggle", () => {
      if (serial.open && !loaded) {
        loaded = true;
        void loadSerial(serial);
      }
    });

    body.append(
      status,
      head,
      spec,
      section("Details", meta),
      section("Disks", disks),
      section("Network", networkCards()),
      section("Usage (last 6h)", usage),
      serial
    );
  }

  function section(title: string, content: HTMLElement): HTMLElement {
    return h("section", { class: "gcp-detail-section" }, h("h3", {}, title), content);
  }

  function specItem(iconName: string, label: string, value: string, sub?: string): HTMLElement {
    return h(
      "div",
      { class: "gcp-spec-item" },
      icon(iconName),
      h("div", {}, h("div", { class: "gcp-spec-value" }, value), h("small", {}, sub ?? label))
    );
  }

  async function loadMachine(spec: HTMLElement, isCurrent: () => boolean): Promise<void> {
    const name = inst.machineTypeName;
    try {
      const mt = await getMachineType(ctx.creds, ctx.projectId, inst.zoneName, name);
      if (!isCurrent()) return;
      spec.replaceChildren(specItem("cpu", "Machine", machineSummary(mt), name));
      spec.title = mt.description ?? "";
    } catch (err) {
      if (!isCurrent()) return;
      spec.replaceChildren(specItem("cpu", "Machine", name, "vCPU/memory unavailable"));
      spec.title = describeError(err, "Couldn't read the machine type");
    }
  }

  async function loadDisks(container: HTMLElement, isCurrent: () => boolean): Promise<void> {
    const attached = inst.disks ?? [];
    if (!attached.length) {
      container.append(h("div", { class: "gcp-muted" }, "No disks attached."));
      return;
    }
    const cards = attached.map((d) => {
      const card = diskCard(d, undefined);
      container.append(card);
      return card;
    });
    const results = await Promise.allSettled(attached.map((d) => (d.source ? getDisk(ctx.creds, d.source) : Promise.reject(new Error("No source")))));
    if (!isCurrent()) return;
    results.forEach((r, i) => {
      const next = r.status === "fulfilled" ? diskCard(attached[i]!, r.value) : diskCard(attached[i]!, null, describeError(r.reason, "Couldn't read the disk"));
      cards[i]!.replaceWith(next);
    });
  }

  // `disk` undefined = loading, null = failed (fall back to the attachment).
  function diskCard(att: AttachedDisk, disk: DiskSummary | null | undefined, error?: string): HTMLElement {
    const name = disk?.name ?? (lastSegment(att.source) || att.deviceName) ?? "disk";
    const size = disk?.sizeGb ?? att.diskSizeGb;
    const facts = [
      disk?.typeName,
      size ? `${size} GB` : undefined,
      att.type === "SCRATCH" ? "local SSD" : undefined,
      att.mode === "READ_ONLY" ? "read-only" : undefined,
      disk?.provisionedIops ? `${disk.provisionedIops} IOPS` : undefined,
      disk?.provisionedThroughput ? `${disk.provisionedThroughput} MB/s` : undefined,
    ].filter(Boolean);
    return h(
      "div",
      { class: "gcp-card", title: error ?? "" },
      h(
        "div",
        { class: "gcp-card-head" },
        icon("hardDrive"),
        h("span", { class: "gcp-title" }, name),
        att.boot ? h("span", { class: "gcp-pill muted" }, "boot") : null,
        h("span", { class: "spacer" }),
        disk?.status ? diskStatus(disk.status) : null
      ),
      h("div", { class: "gcp-card-line" }, facts.join(" · ") || (disk === undefined ? "Loading…" : "")),
      disk?.sourceImage ? h("div", { class: "gcp-card-line muted" }, `Image: ${lastSegment(disk.sourceImage)}`) : null,
      error ? h("div", { class: "gcp-card-line muted" }, "Details unavailable") : null
    );
  }

  function diskStatus(s: string): HTMLElement {
    const tone = s === "READY" ? "ok" : s === "FAILED" ? "off" : s === "CREATING" || s === "RESTORING" ? "busy" : "muted";
    return h("span", { class: `gcp-pill ${tone}` }, s.toLowerCase());
  }

  function networkCards(): HTMLElement {
    const wrap = h("div", { class: "gcp-cards" });
    const nics = inst.networkInterfaces ?? [];
    if (!nics.length) wrap.append(h("div", { class: "gcp-muted" }, "No network interfaces."));
    for (const nic of nics) {
      const access = nic.accessConfigs?.find((a) => a.natIP) ?? nic.accessConfigs?.[0];
      const kv = h("dl", { class: "gcp-card-kv" });
      const add = (k: string, v: string | undefined) => {
        if (v) kv.append(h("dt", {}, k), h("dd", {}, v));
      };
      add("Network", lastSegment(nic.network));
      add("Subnet", lastSegment(nic.subnetwork));
      add("Internal IP", nic.networkIP);
      add(
        "External IP",
        access?.natIP ? `${access.natIP}${access.networkTier ? ` (${access.networkTier.toLowerCase()})` : ""}` : access ? "ephemeral, none assigned" : "None"
      );
      wrap.append(
        h(
          "div",
          { class: "gcp-card" },
          h("div", { class: "gcp-card-head" }, icon("globe"), h("span", { class: "gcp-title" }, nic.name ?? "nic")),
          kv
        )
      );
    }
    return wrap;
  }

  async function loadSerial(container: HTMLElement): Promise<void> {
    const out = h("pre", { class: "gcp-serial-output" }, "Loading…");
    container.append(out);
    try {
      const r = await getSerialPortOutput(ctx.creds, ctx.projectId, inst.zoneName, inst.name);
      out.textContent = r.contents || "(empty)";
      out.scrollTop = out.scrollHeight;
    } catch (err) {
      out.textContent = describeError(err, "Couldn't read serial output");
    }
  }

  function actionButtons(): HTMLElement[] {
    const running = inst.status === "RUNNING";
    const stopped = inst.status === "TERMINATED" || inst.status === "STOPPED";
    const busy = TRANSITIONAL.has(inst.status);
    const btn = (action: InstanceAction, iconName: string, enabled: boolean) => {
      const b = h("button", { type: "button", class: `btn small ${ACTION_COPY[action].danger ? "danger" : ""}`.trim(), disabled: !enabled || busy });
      b.append(icon(iconName), ACTION_COPY[action].label);
      b.addEventListener("click", () => void runAction(action));
      return b;
    };
    return [btn("start", "play", stopped), btn("stop", "square", running), btn("reset", "rotate", running)];
  }

  async function runAction(action: InstanceAction): Promise<void> {
    const copy = ACTION_COPY[action];
    const ok = await confirmDialog({
      title: `${copy.label} ${inst.name}?`,
      message: copy.message,
      confirmLabel: copy.label,
      danger: copy.danger,
    });
    if (!ok) return;
    status.replaceChildren(statusLine("loading", `${copy.verb} ${inst.name}…`));
    try {
      await instanceAction(ctx.creds, ctx.projectId, inst.zoneName, inst.name, action);
      onChanged?.();
      status.replaceChildren(statusLine("info", `${copy.label} requested — the status updates as it takes effect. Refresh to check.`));
      await refresh(false);
    } catch (err) {
      status.replaceChildren(statusLine("error", describeError(err, `Couldn't ${action} the VM`)));
    }
  }

  async function refresh(clearStatus = true): Promise<void> {
    const gen = generation;
    if (clearStatus) status.replaceChildren(statusLine("loading", "Refreshing…"));
    try {
      const next = await getInstance(ctx.creds, ctx.projectId, inst.zoneName, inst.name);
      if (gen !== generation) return;
      inst = next;
      if (clearStatus) clear(status);
      render();
    } catch (err) {
      if (gen !== generation) return;
      status.replaceChildren(statusLine("error", describeError(err, "Couldn't refresh")));
    }
  }
}
