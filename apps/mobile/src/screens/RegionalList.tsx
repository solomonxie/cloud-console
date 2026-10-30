// Resources grouped by region, scanned one region at a time (port of
// RegionalResourceListPage). Each region folds and shows its count; empty
// regions are hidden; failures are listed behind the status bar button.
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { scanRegions, type RegionalScanState } from "@cloud-console/core/regional";
import { REGION_NAMES } from "@cloud-console/core/aws/regions";
import { plural } from "@cloud-console/core/format";
import { awsRegions, cached, staleValue, type Session } from "../services/cloud";
import { Caption, Icon, Screen, StatusBar, Unavailable } from "../components/ui";
import { useTheme } from "../theme";
import { StyleSheet } from "react-native";

export function RegionalList<T>({ session, title, icon, cacheKind, fetch, renderItem, keyOf }: {
  session?: Session;
  title: string;
  icon: string;
  cacheKind: string;
  fetch: (s: Session, region: string) => Promise<T[]>;
  renderItem: (item: T, region: string) => ReactNode;
  keyOf: (item: T) => string;
}) {
  const theme = useTheme();
  const [state, setState] = useState<RegionalScanState<T>>({ results: [], scanning: "regions", scanned: 0, regionCount: 0 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const generation = useRef(0);
  const latest = useRef(state);
  latest.current = state;

  const load = useCallback(
    async (force: boolean) => {
      if (!session) return;
      const mine = ++generation.current;
      await scanRegions<T>({
        key: (region) => `${cacheKind}@${region}:${session.id}`,
        regions: () => awsRegions(session, force),
        fetch: (region) => fetch(session, region),
        cache: { cached: (key, _ttl, f, get) => cached(key, get, { force: f }), stale: (key) => staleValue(key) },
        forceRefresh: force,
        previous: latest.current.results,
        onUpdate: (s) => mine === generation.current && setState(s),
        isCancelled: () => mine !== generation.current,
      });
    },
    [session, cacheKind]
  );

  useEffect(() => {
    void load(false);
    return () => {
      generation.current++;
    };
  }, [load]);

  const visible = state.results.filter((r) => r.items.length > 0);
  const failed = state.results.filter((r) => r.error);
  const count = state.results.reduce((n, r) => n + r.items.length, 0);

  const status = (
    <StatusBar>
      {state.scanning ? (
        <>
          <ActivityIndicator size="small" />
          <Caption>{state.scanning === "regions" ? "Finding regions…" : `Scanning ${state.scanning} (${state.scanned + 1}/${state.regionCount})…`}</Caption>
        </>
      ) : (
        <Caption>{`${plural(count, "item")} · ${state.regionCount} regions`}</Caption>
      )}
      {failed.length > 0 ? (
        <Pressable
          onPress={() => Alert.alert("Regions that failed", failed.map((r) => `${r.region}: ${r.error}`).join("\n\n"))}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Icon name="exclamationmark.triangle.fill" color={theme.orange} size={12} />
          <Caption color={theme.orange}>{`${failed.length} failed`}</Caption>
        </Pressable>
      ) : null}
    </StatusBar>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable accessibilityLabel="Refresh" disabled={!!state.scanning} onPress={() => void load(true)} style={{ opacity: state.scanning ? 0.4 : 1 }}>
              <Icon name="arrow.clockwise" color={theme.tint} size={18} />
            </Pressable>
          ),
        }}
      />
      <Screen refreshing={false} onRefresh={() => void load(true)} footer={status}>
        {!state.scanning && visible.length === 0 && state.regionCount > 0 ? (
          <Unavailable icon={icon} title={title} message={`Nothing in any of ${state.regionCount} regions.`} />
        ) : null}
        {visible.map((result) => {
          const open = !collapsed.has(result.region);
          return (
            <View key={result.region} style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <Pressable
                onPress={() => {
                  const next = new Set(collapsed);
                  if (open) next.add(result.region);
                  else next.delete(result.region);
                  setCollapsed(next);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6 }}
              >
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>{result.region}</Text>
                {REGION_NAMES[result.region] ? <Caption>{REGION_NAMES[result.region]}</Caption> : null}
                <View style={{ flex: 1 }} />
                <View style={{ backgroundColor: theme.fill, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{result.items.length}</Text>
                </View>
                <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
                  <Icon name="chevron.right" color={theme.tint} size={12} />
                </View>
              </Pressable>
              {open ? (
                <View style={{ backgroundColor: theme.card, borderRadius: 10, overflow: "hidden" }}>
                  {result.items.map((item, i) => (
                    <View key={keyOf(item)}>
                      {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator, marginLeft: 60 }} /> : null}
                      {renderItem(item, result.region)}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Screen>
    </>
  );
}
