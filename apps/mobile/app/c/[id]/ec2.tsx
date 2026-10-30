// EC2 instance: details, status checks, and 3 h health tiles refreshed every minute.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { EC2Instance, EC2StatusChecks } from "@cloud-console/core/aws/ec2";
import type { MetricPoint, MetricQuery } from "@cloud-console/core/aws/cloudwatch-metrics";
import { byteCountBinary, formatClock, formatDateTime, formatTime } from "@cloud-console/core/format";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { Caption, DetailRow, Icon, Screen, Section } from "../../../src/components/ui";
import { Sparkline } from "../../../src/components/Sparkline";
import { useTheme } from "../../../src/theme";

interface HealthMetric {
  id: string;
  title: string;
  unit: "percent" | "bytesPerSecond";
  query: MetricQuery;
  needsAgent?: boolean;
}

const WINDOW = 3 * 3600 * 1000;
const PERIOD = 300;

function healthMetrics(instanceId: string): HealthMetric[] {
  const dims = { InstanceId: instanceId };
  const ec2 = (id: string, title: string, name: string, unit: HealthMetric["unit"], stat = "Average"): HealthMetric => ({ id, title, unit, query: { id, namespace: "AWS/EC2", name, dimensions: dims, stat } });
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

const STATUS: Record<string, { label: string; icon: string; tone: "green" | "red" | "orange" | "secondary" }> = {
  ok: { label: "OK", icon: "checkmark.circle.fill", tone: "green" },
  impaired: { label: "Impaired", icon: "xmark.octagon.fill", tone: "red" },
  initializing: { label: "Initializing", icon: "clock.fill", tone: "orange" },
  "insufficient-data": { label: "Insufficient data", icon: "minus.circle", tone: "secondary" },
  "not-applicable": { label: "N/A", icon: "minus.circle", tone: "secondary" },
};

export default function EC2Detail() {
  const theme = useTheme();
  const { region } = useLocalSearchParams<{ region: string }>();
  const instance = useJsonParam<EC2Instance>("instance");
  const { session } = useSession();
  const metrics = useMemo(() => (instance ? healthMetrics(instance.instanceId) : []), [instance?.instanceId]);
  const [checks, setChecks] = useState<EC2StatusChecks>();
  const [series, setSeries] = useState<Record<string, MetricPoint[]>>({});
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!session || !instance) return;
    const now = Date.now();
    try {
      const [c, s] = await Promise.all([
        cloud.ec2StatusChecks(session, instance.instanceId, region),
        cloud.metricSeries(session, metrics.map((m) => m.query), now - WINDOW, now, PERIOD, region),
      ]);
      setChecks(c);
      // Sums per period → bytes per second.
      const out: Record<string, MetricPoint[]> = {};
      for (const [id, points] of Object.entries(s)) {
        const perSecond = metrics.find((m) => m.id === id)?.unit === "bytesPerSecond";
        out[id] = perSecond ? points.map((p) => ({ time: p.time, value: p.value / PERIOD })) : points;
      }
      setSeries(out);
      setUpdatedAt(now);
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [session, instance?.instanceId, region]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!instance) return null;
  const tone = (t: string) => (t === "green" ? theme.green : t === "red" ? theme.red : t === "orange" ? theme.orange : theme.secondary);

  const statusRow = (title: string, status?: string) => {
    const s = status ? (STATUS[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1), icon: "minus.circle", tone: "secondary" }) : { label: "—", icon: "minus.circle", tone: "secondary" as const };
    return (
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11 }}>
        <Text style={{ flex: 1, color: theme.text, fontSize: 17 }}>{title}</Text>
        <Icon name={s.icon} color={tone(s.tone)} size={16} />
        <Text style={{ color: tone(s.tone), fontSize: 17, marginLeft: 6 }}>{s.label}</Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: instance.name || instance.instanceId }} />
      <Screen refreshing={false} onRefresh={() => void load()}>
        <Section title="Details">
          <DetailRow label="Instance ID" value={instance.instanceId} />
          <DetailRow label="Type" value={instance.instanceType} />
          <DetailRow label="State" value={instance.state} />
          <DetailRow label="Name" value={instance.name || "—"} />
          <DetailRow label="Launched" value={instance.launchTime ? formatDateTime(instance.launchTime) : "—"} />
          <DetailRow label="Region" value={region} />
        </Section>
        <Section title="Status checks">
          {statusRow("System", checks?.system)}
          {statusRow("Instance", checks?.instance)}
          {statusRow("Attached EBS", checks?.ebs)}
        </Section>
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.secondary, fontSize: 13, marginLeft: 16, marginBottom: 6, textTransform: "uppercase" }}>Health · last 3 h</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {metrics.map((m) => (
              <HealthTile key={m.id} metric={m} points={series[m.id] ?? []} />
            ))}
          </View>
          <View style={{ marginHorizontal: 16, marginTop: 8, gap: 4 }}>
            {error ? <Caption color={theme.orange}>{error}</Caption> : null}
            {instance.state !== "running" ? <Caption>{`Instance is ${instance.state} — no new data points.`}</Caption> : null}
            <Caption>{`CloudWatch reports every 5 min (1 min with detailed monitoring). Refreshes every minute${updatedAt ? `; updated ${formatTime(updatedAt)}` : ""}.`}</Caption>
          </View>
        </View>
      </Screen>
    </>
  );
}

function HealthTile({ metric, points }: { metric: HealthMetric; points: MetricPoint[] }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<MetricPoint>();
  const shown = selected ?? points[points.length - 1];
  const format = (v: number) => (metric.unit === "percent" ? `${v.toFixed(1)}%` : `${byteCountBinary(v)}/s`);
  const max = metric.unit === "percent" ? 100 : Math.max(1, ...points.map((p) => p.value));
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1, backgroundColor: theme.card, borderRadius: 14, padding: 12, gap: 6 }}>
      <Caption>{metric.title}</Caption>
      {shown ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={{ flex: 1, color: theme.text, fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{format(shown.value)}</Text>
            {selected ? <Caption>{formatClock(selected.time).slice(0, 5)}</Caption> : null}
          </View>
          <Sparkline points={points} max={max} color={theme.tint} onSelect={setSelected} />
        </>
      ) : (
        <Text style={{ color: theme.secondary, fontSize: 13, minHeight: 66 }}>{metric.needsAgent ? "Needs CloudWatch agent" : "No data"}</Text>
      )}
    </View>
  );
}
