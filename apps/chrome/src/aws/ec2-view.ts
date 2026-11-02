// EC2: every enabled region's instances, grouped by region (the mobile app's
// RegionalList), and an instance page like its ec2.tsx — details, status
// checks, and 3 h CloudWatch health sparklines refreshed every minute. The
// mobile app has no start/stop/reboot, so neither does this.
import { listInstances, statusChecks, type EC2Instance, type EC2StatusChecks } from "@cloud-console/core/aws/ec2";
import { metricSeries, type MetricPoint, type MetricQuery } from "@cloud-console/core/aws/cloudwatch-metrics";
import { byteCountBinary, formatDateTime } from "@cloud-console/core/format";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav, type Screen } from "../app/nav.ts";
import { h, iconButton, statusLine } from "../gcp/dom.ts";
import { awsKey, describe } from "./common.ts";
import { sparkline } from "./sparkline.ts";
import { detailList, regionalListScreen, screenSubtitle, section, statePill } from "./ui.ts";

registerKindScreen("aws", "ec2", (conn) =>
  regionalListScreen<EC2Instance>({
    conn,
    kind: "ec2",
    cacheKind: "ec2-instances",
    title: "EC2 Instances",
    noun: ["instance", "instances"],
    filter: "Filter by name, ID, type, state…",
    emptyIcon: "server",
    fetch: (region) => listInstances(awsKey(conn), region),
    row: (i, region) => ({
      icon: "server",
      title: i.name || i.instanceId,
      subtitle: [i.name ? i.instanceId : undefined, i.instanceType].filter(Boolean).join(" · "),
      pill: statePill(i.state),
      search: [i.name, i.instanceId, i.instanceType, i.state, region].join(" "),
      favId: `${region}/${i.instanceId}`,
      onOpen: () => nav.push(ec2Screen(conn, i, region)),
    }),
  })
);

interface HealthMetric {
  id: string;
  title: string;
  unit: "percent" | "bytesPerSecond";
  query: MetricQuery;
  needsAgent?: boolean;
}

const WINDOW = 3 * 3600 * 1000;
const PERIOD = 300;

// Same tiles as the mobile app; memory and disk need the CloudWatch agent.
function healthMetrics(instanceId: string): HealthMetric[] {
  const dims = { InstanceId: instanceId };
  const ec2 = (id: string, title: string, name: string, unit: HealthMetric["unit"], stat = "Average"): HealthMetric => ({
    id, title, unit, query: { id, namespace: "AWS/EC2", name, dimensions: dims, stat },
  });
  const agent = (id: string, title: string, name: string, extra = ""): HealthMetric => ({
    id, title, unit: "percent", needsAgent: true,
    query: { id, namespace: "CWAgent", name, dimensions: dims, search: `Namespace="CWAgent" MetricName="${name}" InstanceId="${instanceId}"${extra}` },
  });
  return [
    ec2("cpu", "CPU", "CPUUtilization", "percent"),
    agent("mem", "Memory", "mem_used_percent"),
    agent("disk", "Disk used (/)", "disk_used_percent", ` path="/"`),
    ec2("netIn", "Network in", "NetworkIn", "bytesPerSecond", "Sum"),
    ec2("netOut", "Network out", "NetworkOut", "bytesPerSecond", "Sum"),
    ec2("diskRead", "Disk read", "EBSReadBytes", "bytesPerSecond", "Sum"),
    ec2("diskWrite", "Disk write", "EBSWriteBytes", "bytesPerSecond", "Sum"),
  ];
}

const STATUS: Record<string, { label: string; tone: string }> = {
  ok: { label: "OK", tone: "ok" },
  impaired: { label: "Impaired", tone: "off" },
  initializing: { label: "Initializing", tone: "busy" },
  "insufficient-data": { label: "Insufficient data", tone: "muted" },
  "not-applicable": { label: "N/A", tone: "muted" },
};

function checkPill(status: string | undefined): HTMLElement {
  const s = status ? (STATUS[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1), tone: "muted" }) : { label: "—", tone: "muted" };
  return h("span", { class: `gcp-pill ${s.tone}` }, s.label);
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ec2Screen(conn: StorageConnection, inst: EC2Instance, region: string): Screen {
  const metrics = healthMetrics(inst.instanceId);
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const checksEl = h("dl", { class: "detail-meta aws-meta" });
  const grid = h("div", { class: "gcp-spark-grid" });
  const note = h("div", { class: "aws-notes" });
  const cells = new Map<string, { value: HTMLElement; plot: HTMLElement; cell: HTMLElement }>();
  for (const m of metrics) {
    const value = h("span", { class: "gcp-spark-value" }, "…");
    const plot = h("div", { class: "gcp-spark-plot" });
    const cell = h("div", { class: "gcp-spark loading" }, h("div", { class: "gcp-spark-head" }, h("span", { class: "gcp-spark-label" }, m.title), value), plot);
    grid.append(cell);
    cells.set(m.id, { value, plot, cell });
  }

  const renderChecks = (c: EC2StatusChecks | undefined) => {
    checksEl.replaceChildren();
    for (const [label, s] of [["System", c?.system], ["Instance", c?.instance], ["Attached EBS", c?.ebs]] as const) {
      checksEl.append(h("dt", {}, label), h("dd", {}, checkPill(s)));
    }
  };
  renderChecks(undefined);

  const format = (m: HealthMetric, v: number) => (m.unit === "percent" ? `${v.toFixed(1)}%` : `${byteCountBinary(v)}/s`);

  const load = async () => {
    const gen = ++generation;
    const now = Date.now();
    const key = awsKey(conn);
    let error: string | undefined;
    const [c, s] = await Promise.allSettled([
      statusChecks(key, inst.instanceId, region),
      metricSeries(key, { queries: metrics.map((m) => m.query), from: now - WINDOW, to: now, period: PERIOD, region }),
    ]);
    if (gen !== generation) return;
    if (c.status === "fulfilled") renderChecks(c.value);
    else error = describe(c.reason, "Couldn't load status checks");
    if (s.status === "fulfilled") {
      for (const m of metrics) {
        const raw = s.value[m.id] ?? [];
        // Sums per period → bytes per second.
        const points: MetricPoint[] = m.unit === "bytesPerSecond" ? raw.map((p) => ({ time: p.time, value: p.value / PERIOD })) : raw;
        const { value, plot, cell } = cells.get(m.id)!;
        cell.classList.remove("loading");
        if (!points.length) {
          value.textContent = "—";
          plot.replaceChildren(h("span", { class: "gcp-spark-note" }, m.needsAgent ? "Needs CloudWatch agent" : "No data"));
          continue;
        }
        const latest = points[points.length - 1]!;
        const latestText = format(m, latest.value);
        value.textContent = latestText;
        value.title = `Latest, ${timeLabel(latest.time)}`;
        const max = m.unit === "percent" ? 100 : undefined;
        plot.replaceChildren(
          sparkline(points, { max, label: `${m.title}, last 3 hours: latest ${latestText}`, format: (v) => format(m, v) }, (p) => {
            value.textContent = p ? format(m, p.value) : latestText;
            value.classList.toggle("hover", !!p);
            value.title = p ? timeLabel(p.time) : `Latest, ${timeLabel(latest.time)}`;
          })
        );
      }
    } else {
      error = error ?? describe(s.reason, "Couldn't load metrics");
      for (const { value, plot, cell } of cells.values()) {
        cell.classList.remove("loading");
        value.textContent = "—";
        plot.replaceChildren(h("span", { class: "gcp-spark-note" }, "Couldn't load"));
      }
    }
    note.replaceChildren(
      error ? statusLine("error", error) : "",
      inst.state !== "running" ? h("div", {}, `Instance is ${inst.state} — no new data points.`) : "",
      h("div", {}, `CloudWatch reports every 5 min (1 min with detailed monitoring). Refreshes every minute; updated ${timeLabel(now)}.`)
    );
  };

  return {
    title: inst.name || inst.instanceId,
    subtitle: screenSubtitle(conn, region),
    render(body, header) {
      body.classList.add("gcp-detail");
      header.actions.append(iconButton("refresh", "Refresh", () => void load()));
      const head = h(
        "div",
        { class: "gcp-detail-head" },
        statePill(inst.state) ?? "",
        h("span", { class: "gcp-detail-machine" }, inst.instanceType)
      );
      body.append(
        head,
        section(
          "Details",
          detailList([
            ["Instance ID", inst.instanceId],
            ["Type", inst.instanceType],
            ["State", inst.state],
            ["Name", inst.name || "—"],
            ["Launched", inst.launchTime ? formatDateTime(inst.launchTime) : "—"],
            ["Region", region],
          ])
        ),
        section("Status checks", checksEl),
        section("Health · last 3 h", grid, note)
      );
      void load();
      timer = setInterval(() => void load(), 60_000);
    },
    onLeave() {
      generation++;
      if (timer) clearInterval(timer);
    },
  };
}
