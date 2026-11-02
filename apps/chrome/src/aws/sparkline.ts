// A single-series inline-SVG area sparkline (same look as the GCP usage
// tiles, gcp.css .gcp-sparkline); `onHover` reports the nearest point while
// the pointer is over it (null when it leaves).
import type { MetricPoint } from "@cloud-console/core/aws/cloudwatch-metrics";

const W = 120;
const HGT = 32;
const PAD = 2;
const NS = "http://www.w3.org/2000/svg";

export function sparkline(
  points: MetricPoint[],
  opts: { max?: number; label: string; format: (v: number) => string },
  onHover: (p: MetricPoint | null) => void
): SVGSVGElement {
  const t0 = points[0]!.time;
  const t1 = points[points.length - 1]!.time;
  const peak = Math.max(...points.map((p) => p.value));
  const top = opts.max ?? Math.max(peak * 1.15, 1);
  const x = (t: number) => (t1 === t0 ? W / 2 : PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2));
  const y = (v: number) => HGT - PAD - (Math.min(v, top) / top) * (HGT - PAD * 2);
  const coords = points.map((p) => `${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${HGT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${opts.label}, peak ${opts.format(peak)}`);
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
