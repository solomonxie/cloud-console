// Month-to-date total, balance, cost by service, and a year of history;
// each service drills into its usage / resource split.
import React from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { formatCurrency, monthLabel } from "@cloud-console/core/format";
import { shortServiceName, type MonthToDateCost, type ServiceCost } from "@cloud-console/core/billing";
import * as cloud from "../services/cloud";
import { useLoad } from "../components/hooks";
import { Button, Caption, Disclosure, Loading, Muted, Row, Screen, Section, Spinner, Unavailable } from "../components/ui";
import { nav } from "../nav";
import { useTheme } from "../theme";

export function CostRow({ name, amount, unit, onPress, small }: { name: string; amount: number; unit: string; onPress?: () => void; small?: boolean }) {
  const theme = useTheme();
  return (
    <Row onPress={onPress} chevron={!!onPress}>
      <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: small ? 15 : 17 }}>
        {name}
      </Text>
      <Text style={{ color: theme.secondary, fontSize: small ? 15 : 17 }}>{formatCurrency(amount, unit)}</Text>
    </Row>
  );
}

export function BigTotal({ amount, unit, caption }: { amount: number; unit: string; caption: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 6 }}>
      <Text style={{ color: theme.text, fontSize: 40, fontWeight: "700" }} adjustsFontSizeToFit numberOfLines={1}>
        {formatCurrency(amount, unit)}
      </Text>
      <Caption>{caption}</Caption>
    </View>
  );
}

export function BillingScreen({ session }: { session?: cloud.Session }) {
  const theme = useTheme();
  const mtd = useLoad(session, cloud.monthToDate);
  const history = useLoad(session, cloud.billingHistory);
  const subtitle = session?.connection.name;

  const serviceLink = (item: ServiceCost, bill: MonthToDateCost) => (
    <CostRow key={item.serviceName} name={shortServiceName(item.serviceName)} amount={item.amount} unit={bill.unit} onPress={() => session && nav.billingDetail(session.connection.id, item, bill)} />
  );

  let body;
  const cost = mtd.value;
  if (mtd.loading && !cost) body = <Loading label="Loading costs…" />;
  else if (mtd.error)
    body = (
      <Screen>
        <Unavailable icon="exclamationmark.triangle" title="Couldn't load billing" message={mtd.error} action={{ label: "Retry", onPress: () => void mtd.reload(true) }} />
      </Screen>
    );
  else if (cost)
    body = (
      <Screen
        refreshing={mtd.loading}
        onRefresh={() => {
          void mtd.reload(true);
          void history.reload(true);
        }}
      >
        <Section>
          <BigTotal amount={cost.total} unit={cost.unit} caption={`Month to date${cost.isEstimated ? " · estimated" : ""}`} />
        </Section>
        {cost.balance !== undefined ? (
          <Section title="Balance">
            <Row>
              <Text style={{ flex: 1, color: theme.text, fontSize: 17 }}>Remaining</Text>
              <Text style={{ color: cost.balance < 0 ? theme.red : theme.text, fontSize: 17 }}>{formatCurrency(cost.balance, cost.unit)}</Text>
            </Row>
          </Section>
        ) : null}
        {cost.byService.length === 0 ? (
          <Section>
            <Muted>No costs recorded yet this month.</Muted>
          </Section>
        ) : (
          <Section title="By service">{cost.byService.map((s) => serviceLink(s, cost))}</Section>
        )}
        <Section title="History">
          {history.loading && !history.value ? (
            <Spinner />
          ) : history.error ? (
            <View style={{ padding: 12, gap: 4 }}>
              <Caption>{history.error}</Caption>
              <Button label="Retry" onPress={() => void history.reload(true)} />
            </View>
          ) : (history.value ?? []).length === 0 ? (
            <Muted>No history yet.</Muted>
          ) : (
            (history.value ?? []).map((bill) => (
              <Disclosure
                key={bill.periodStart}
                label={
                  <View style={{ flexDirection: "row" }}>
                    <Text style={{ flex: 1, color: theme.text, fontSize: 17 }}>{monthLabel(bill.periodStart)}</Text>
                    <Text style={{ color: theme.secondary, fontSize: 17 }}>{formatCurrency(bill.total, bill.unit)}</Text>
                  </View>
                }
              >
                {bill.byService.length === 0 ? <Muted>No costs recorded.</Muted> : bill.byService.map((s) => serviceLink(s, bill))}
              </Disclosure>
            ))
          )}
        </Section>
      </Screen>
    );

  return (
    <>
      <Stack.Screen options={{ title: "Billing", headerBackTitle: subtitle }} />
      {body}
    </>
  );
}
