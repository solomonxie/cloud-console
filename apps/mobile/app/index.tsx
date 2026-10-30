// Home: one floating card per connection (its services as rows), then the
// Settings card.
import React from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from "react-native";
import { router, Stack } from "expo-router";
import { availableVendors, resourceKinds, VENDORS } from "@cloud-console/core/catalog";
import { formatMonthDay } from "@cloud-console/core/format";
import { useStore } from "../src/state/store";
import { connections, removeConnection, type Connection } from "../src/state/connections";
import { Badge, Card, Icon, Row, Screen, Unavailable } from "../src/components/ui";
import { SettingsCard } from "../src/screens/SettingsCard";
import { KIND_ICON, VENDOR_ICON } from "../src/vendors";
import { useTheme, VENDOR_ACCENT } from "../src/theme";

export default function Home() {
  const theme = useTheme();
  const list = useStore(connections);
  const available = new Set(availableVendors("mobile").map((v) => v.id));
  const visible = list.filter((c) => available.has(c.vendor));

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityLabel="Add connection" hitSlop={10} onPress={() => router.push("/add")}>
              <Icon name="plus" color={theme.tint} size={20} />
            </Pressable>
          ),
        }}
      />
      <Screen>
        {visible.length === 0 ? (
          <Unavailable
            icon="cloud"
            title="No connections yet"
            message="Add a cloud account with an access key — this app only does what that key can do."
            action={{ label: "Add connection", onPress: () => router.push("/add"), prominent: true }}
          />
        ) : (
          visible.map((c) => <ConnectionCard key={c.id} connection={c} />)
        )}
        <SettingsCard />
      </Screen>
    </>
  );
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const theme = useTheme();
  const vendor = VENDORS.find((v) => v.id === connection.vendor)!;
  const accent = VENDOR_ACCENT[connection.vendor];

  const confirmRemove = () =>
    Alert.alert(`Remove ${connection.name}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void removeConnection(connection) },
    ]);

  const menu = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Remove connection", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (i) => i === 0 && confirmRemove()
      );
    } else confirmRemove();
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
        <Badge icon={VENDOR_ICON} color={accent} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700" }} numberOfLines={1}>
            {connection.name}
          </Text>
          <Text style={{ color: theme.secondary, fontSize: 12 }}>
            {vendor.name} · added {formatMonthDay(connection.addedAt)}
          </Text>
        </View>
        <Pressable accessibilityLabel="Connection options" hitSlop={10} onPress={menu}>
          <Icon name="ellipsis.circle.fill" color={theme.tertiary} size={24} />
        </Pressable>
      </View>
      {resourceKinds(connection.vendor, "mobile").map((kind) => (
        <Row key={kind.id} chevron onPress={() => router.push({ pathname: "/c/[id]/[kind]", params: { id: connection.id, kind: kind.id } })}>
          <Badge icon={KIND_ICON[kind.id]} color={accent} size={34} />
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "500" }}>{kind.title}</Text>
        </Row>
      ))}
    </Card>
  );
}
