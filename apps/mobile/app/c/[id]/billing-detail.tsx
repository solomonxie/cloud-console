// One service's bill for one period: by usage category, then by resource.
import React from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { dayLabel, formatCurrency, monthLabel } from "@cloud-console/core/format";
import { shortServiceName, type MonthToDateCost, type ServiceCost, type ServiceCostDetail } from "@cloud-console/core/billing";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useLoad, useSession } from "../../../src/components/hooks";
import { Caption, Disclosure, Loading, Muted, Screen, Section, Unavailable } from "../../../src/components/ui";
import { BigTotal, CostRow } from "../../../src/screens/Billing";
import { useTheme } from "../../../src/theme";

function resourceHeader(display: string): string {
  if (display === "S3" || display === "COS") return "By bucket";
  if (display === "Lambda" || display === "SCF") return "By function";
  if (display === "EC2" || display === "CVM") return "By instance";
  if (display === "RDS" || display === "MySQL") return "By database";
  return "By resource";
}

/** ARNs shortened to their last segment. */
function resourceLabel(id: string): string {
  if (!id || id === "NoResourceId") return "Not tied to a resource";
  if (!id.startsWith("arn:")) return id;
  return id.split(/[:/]/).pop() || id;
}

export default function BillingDetail() {
  const { session } = useSession();
  const service = useJsonParam<ServiceCost>("service");
  const bill = useJsonParam<MonthToDateCost>("bill");
  const data = useLoad<ServiceCostDetail>(session, (s, force) => cloud.serviceDetail(s, service!, bill!, force));
  if (!service || !bill) return null;
  const display = shortServiceName(service.serviceName);
  const detail = data.value;

  let body;
  if (data.loading && !detail) body = <Loading label={`Loading ${display} costs…`} />;
  else if (data.error)
    body = (
      <Screen>
        <Unavailable icon="exclamationmark.triangle" title={`Couldn't load ${display} costs`} message={data.error} action={{ label: "Retry", onPress: () => void data.reload(true) }} />
      </Screen>
    );
  else if (detail) {
    const footer = [
      detail.resourcesFrom && detail.resourcesTo
        ? `${dayLabel(detail.resourcesFrom)} – ${dayLabel(detail.resourcesTo)}` + (detail.resourcesFrom > bill.periodStart ? " (last 14 days kept by AWS)" : "")
        : undefined,
      detail.resourcesNote,
    ].filter(Boolean);
    body = (
      <Screen refreshing={data.loading} onRefresh={() => void data.reload(true)}>
        <Section>
          <BigTotal amount={detail.total} unit={detail.unit} caption={`${service.serviceName} · ${monthLabel(bill.periodStart)}`} />
        </Section>
        <Section title="By usage">
          {detail.usage.length === 0 ? <Muted>No usage recorded.</Muted> : null}
          {detail.usage.map((u) => (
            <CostRow key={u.name} name={u.name} amount={u.amount} unit={detail.unit} />
          ))}
        </Section>
        <Section title={resourceHeader(display)} footer={footer.length ? <Caption>{footer.join("\n")}</Caption> : undefined}>
          {detail.resources.length === 0 && !detail.resourcesNote ? <Muted>No per-resource costs recorded.</Muted> : null}
          {detail.resources.map((r) => (
            <Disclosure key={r.resourceID} label={<CostRowInline name={resourceLabel(r.resourceID)} amount={r.amount} unit={detail.unit} />}>
              {r.usage.map((u) => (
                <CostRow key={u.name} name={u.name} amount={u.amount} unit={detail.unit} small />
              ))}
            </Disclosure>
          ))}
        </Section>
      </Screen>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: display }} />
      {body}
    </>
  );
}

function CostRowInline({ name, amount, unit }: { name: string; amount: number; unit: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, color: theme.text, fontSize: 17 }}>{name}</Text>
      <Text style={{ color: theme.secondary, fontSize: 17 }}>{formatCurrency(amount, unit)}</Text>
    </View>
  );
}
