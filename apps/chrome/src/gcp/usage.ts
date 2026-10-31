// An instance's "Usage (last 6h)" block: one small inline-SVG sparkline per
// Cloud Monitoring metric, loaded lazily and in parallel. Needs
// roles/monitoring.viewer; memory needs the Ops Agent on the VM.

import { INSTANCE_METRICS, instanceMetricSeries, type InstanceMetric, type MetricPoint } from "@cloud-console/core/gcp/monitoring";
import { GcpApiError } from "@cloud-console/core/gcp/request";
import { formatSize } from "@cloud-console/core/storage/format";
import type { ProjectContext } from "./context.ts";
import { h, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";

const LABELS: Record<InstanceMetric["id"], string> = {
  cpu: "CPU",
  memory: "Memory",
  networkIn: "Network in",
  networkOut: "Network out",
  diskRead: "Disk read",
  diskWrite: "Disk write",
};

const MINUTES = 360;

export function formatMetric(metric: InstanceMetric, value: number): string {
  if (metric.unit === "percent") return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
  return `${formatSize(value)}/s`;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Renders the usage section into `container`. `isCurrent` guards against a
// refresh or navigation that happened while the series were loading.
export async function renderUsage(container: HTMLElement, ctx: ProjectContext, instanceId: string, isCurrent: () => boolean): Promise<void> {
  const grid = h("div", { class: "gcp-spark-grid" });
  const cells = INSTANCE_METRICS.map((m) => {
    const value = h("span", { class: "gcp-spark-value" }, "…");
    const plot = h("div", { class: "gcp-spark-plot" });
    const cell = h(
      "div",
      { class: "gcp-spark loading" },
      h("div", { class: "gcp-spark-head" }, h("span", { class: "gcp-spark-label" }, LABELS[m.id]), value),
      plot
    );
    grid.append(cell);
    return { metric: m, cell, value, plot };
  });
  container.replaceChildren(grid);

  const results = await Promise.allSettled(
    INSTANCE_METRICS.map((m) => instanceMetricSeries(ctx.creds, ctx.projectId, instanceId, m, { minutes: MINUTES }))
  );
  if (!isCurrent()) return;

  // A missing role or a disabled API fails every metric the same way —
  // say it once instead of six times.
  const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (first && results.every((r) => r.status === "rejected")) {
    const err = first.reason;
    const msg =
      err instanceof GcpApiError && err.isPermissionDenied
        ? "Usage needs the Monitoring Viewer role (roles/monitoring.viewer) on this project."
        : describeError(err, "Couldn't load usage");
    container.replaceChildren(statusLine("info", msg));
    return;
  }

  results.forEach((r, i) => {
    const { metric, cell, value, plot } = cells[i]!;
    cell.classList.remove("loading");
    if (r.status === "rejected") {
      const denied = r.reason instanceof GcpApiError && r.reason.isPermissionDenied;
      value.textContent = "—";
      plot.replaceChildren(h("span", { class: "gcp-spark-note" }, denied ? "Needs monitoring.viewer" : "Couldn't load"));
      plot.title = describeError(r.reason, `Couldn't load ${LABELS[metric.id].toLowerCase()}`);
      return;
    }
    const points = r.value;
    if (!points.length) {
      value.textContent = "—";
      plot.replaceChildren(h("span", { class: "gcp-spark-note" }, metric.id === "memory" ? "Needs the Ops Agent" : "No data"));
      return;
    }
    const latest = points[points.length - 1]!;
    const latestText = formatMetric(metric, latest.value);
    value.textContent = latestText;
    value.title = `Latest, ${timeLabel(latest.time)}`;
    plot.replaceChildren(sparkline(points, metric, (p) => {
      value.textContent = p ? formatMetric(metric, p.value) : latestText;
      value.classList.toggle("hover", !!p);
      value.title = p ? timeLabel(p.time) : `Latest, ${timeLabel(latest.time)}`;
    }));
  });
}

const W = 120;
const HGT = 32;
const PAD = 2;

// A single-series area sparkline; `onHover` reports the nearest point while
// the pointer is over it (null when it leaves) so the value label can follow.
function sparkline(points: MetricPoint[], metric: InstanceMetric, onHover: (p: MetricPoint | null) => void): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const t0 = points[0]!.time;
  const t1 = points[points.length - 1]!.time;
  const peak = Math.max(...points.map((p) => p.value));
  // Percentages keep a sensible floor so an idle VM doesn't look busy.
  const top = Math.max(peak * 1.15, metric.unit === "percent" ? 5 : 1);
  const x = (t: number) => (t1 === t0 ? W / 2 : PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2));
  const y = (v: number) => HGT - PAD - (v / top) * (HGT - PAD * 2);
  const coords = points.map((p) => `${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${HGT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${LABELS[metric.id]} over the last ${MINUTES / 60} hours: latest ${formatMetric(metric, points[points.length - 1]!.value)}, peak ${formatMetric(metric, peak)}`
  );
  svg.classList.add("gcp-sparkline");

  const area = document.createElementNS(NS, "polygon");
  area.setAttribute("points", `${x(t0).toFixed(1)},${HGT - PAD} ${coords.join(" ")} ${x(t1).toFixed(1)},${HGT - PAD}`);
  area.setAttribute("class", "area");
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", coords.join(" "));
  line.setAttribute("class", "line");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  const cursor = document.createElementNS(NS, "line");
  cursor.setAttribute("class", "cursor");
  cursor.setAttribute("y1", "0");
  cursor.setAttribute("y2", String(HGT));
  cursor.setAttribute("vector-effect", "non-scaling-stroke");
  cursor.style.display = "none";
  svg.append(area, line, cursor);

  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = points[0]!;
    for (const p of points) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
    const cx = x(best.time).toFixed(1);
    cursor.setAttribute("x1", cx);
    cursor.setAttribute("x2", cx);
    cursor.style.display = "";
    onHover(best);
  });
  svg.addEventListener("pointerleave", () => {
    cursor.style.display = "none";
    onHover(null);
  });
  return svg;
}
