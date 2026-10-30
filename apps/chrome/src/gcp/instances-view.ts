import {
  getInstance,
  getSerialPortOutput,
  instanceAction,
  listInstances,
  type InstanceAction,
  type InstanceSummary,
} from "@cloud-console/core/gcp/compute";
import { consoleLinks } from "./console-links.ts";
import type { ViewContext } from "./context.ts";
import { clear, confirmDialog, emptyState, externalLink, formatTime, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";

const TRANSITIONAL = new Set(["PROVISIONING", "STAGING", "STOPPING", "SUSPENDING", "REPAIRING"]);

export function statusPill(status: string | undefined): HTMLElement {
  const s = status ?? "UNKNOWN";
  const tone =
    s === "RUNNING" ? "ok" : s === "TERMINATED" || s === "STOPPED" || s === "SUSPENDED" ? "off" : TRANSITIONAL.has(s) ? "busy" : "muted";
  return h("span", { class: `gcp-pill ${tone}` }, s.toLowerCase());
}

export async function renderInstances(container: HTMLElement, ctx: ViewContext): Promise<void> {
  clear(container);
  container.append(statusLine("loading", "Loading VM instances…"));
  let instances: InstanceSummary[];
  try {
    instances = await listInstances(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    clear(container);
    container.append(statusLine("error", describeError(err, "Couldn't list VM instances")));
    return;
  }
  if (!ctx.isCurrent()) return;
  clear(container);
  if (!instances.length) {
    container.append(emptyState("server", "No VM instances", "This project has no Compute Engine instances."));
    return;
  }
  const list = h("div", { class: "gcp-list" });
  for (const inst of instances) list.append(instanceRow(inst, ctx, () => renderInstances(container, ctx)));
  container.append(list, h("div", { class: "list-stats" }, `${instances.length} instance${instances.length === 1 ? "" : "s"}`));
}

function instanceRow(inst: InstanceSummary, ctx: ViewContext, reload: () => void): HTMLElement {
  const badge = h("span", { class: "badge" });
  badge.append(icon("server"));
  const ips = [inst.internalIp, inst.externalIp].filter(Boolean).join(" · ");
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0 },
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
  const open = () => openInstanceSheet(inst, ctx, reload);
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

function openInstanceSheet(initial: InstanceSummary, ctx: ViewContext, reload: () => void): void {
  let inst = initial;
  let changed = false;
  const dialog = h("dialog", { class: "sheet-dialog gcp-dialog" });
  const titleEl = h("h2", {}, inst.name);
  const body = h("div", { class: "sheet-body" });
  const actions = h("div", { class: "modal-actions sheet-actions" });
  const close = () => {
    dialog.close();
    dialog.remove();
    if (changed) reload();
  };
  dialog.append(
    h(
      "div",
      { class: "sheet-header" },
      titleEl,
      externalLink(consoleLinks.instance(ctx.projectId, inst.zoneName, inst.name)),
      iconButton("refresh", "Refresh", () => void refresh()),
      iconButton("x", "Close", close)
    ),
    body,
    actions
  );
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  const status = h("div", {});
  function renderBody(): void {
    clear(body);
    const meta = h("dl", { class: "detail-meta" });
    const row = (k: string, v: Node | string | undefined) => {
      if (v === undefined || v === "") return;
      meta.append(h("dt", {}, k), h("dd", {}, v));
    };
    row("Status", statusPill(inst.status));
    row("Zone", inst.zoneName);
    row("Machine type", inst.machineTypeName);
    row("Internal IP", inst.internalIp);
    row("External IP", inst.externalIp);
    row("CPU platform", inst.cpuPlatform);
    row("Network", inst.networkInterfaces?.map((n) => n.network?.split("/").pop()).filter(Boolean).join(", "));
    row("Disks", inst.disks?.map((d) => `${d.deviceName}${d.boot ? " (boot)" : ""} ${d.diskSizeGb ?? "?"} GB`).join(", "));
    row("Service account", inst.serviceAccounts?.map((s) => s.email).join(", "));
    row("Provisioning", inst.scheduling?.provisioningModel ?? (inst.scheduling?.preemptible ? "PREEMPTIBLE" : undefined));
    row("Labels", inst.labels ? Object.entries(inst.labels).map(([k, v]) => `${k}=${v}`).join(", ") : undefined);
    row("Network tags", inst.tags?.items?.join(", "));
    row("Created", formatTime(inst.creationTimestamp));
    row("Last started", formatTime(inst.lastStartTimestamp));
    row("Last stopped", formatTime(inst.lastStopTimestamp));
    row("Status message", inst.statusMessage);
    const serial = h("details", { class: "gcp-serial" }, h("summary", {}, "Serial port output"));
    let loaded = false;
    serial.addEventListener("toggle", () => {
      if (serial.open && !loaded) {
        loaded = true;
        void loadSerial(serial);
      }
    });
    body.append(status, meta, serial);
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

  function renderActions(): void {
    clear(actions);
    const running = inst.status === "RUNNING";
    const stopped = inst.status === "TERMINATED" || inst.status === "STOPPED";
    const busy = TRANSITIONAL.has(inst.status);
    const btn = (action: InstanceAction, iconName: string, enabled: boolean) => {
      const b = h("button", { type: "button", class: `btn ${ACTION_COPY[action].danger ? "danger" : ""}`.trim(), disabled: !enabled || busy });
      b.append(icon(iconName), ACTION_COPY[action].label);
      b.addEventListener("click", () => void runAction(action));
      return b;
    };
    actions.append(btn("start", "play", stopped), btn("stop", "square", running), btn("reset", "rotate", running));
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
      changed = true;
      status.replaceChildren(statusLine("info", `${copy.label} requested — the status updates as it takes effect.`));
      await refresh(false);
    } catch (err) {
      status.replaceChildren(statusLine("error", describeError(err, `Couldn't ${action} the VM`)));
    }
  }

  async function refresh(clearStatus = true): Promise<void> {
    try {
      inst = await getInstance(ctx.creds, ctx.projectId, inst.zoneName, inst.name);
      const keep = clearStatus ? null : status.firstChild;
      renderBody();
      if (keep) status.replaceChildren(keep);
      renderActions();
    } catch (err) {
      status.replaceChildren(statusLine("error", describeError(err, "Couldn't refresh")));
    }
  }

  renderBody();
  renderActions();
  document.body.appendChild(dialog);
  dialog.showModal();
}
