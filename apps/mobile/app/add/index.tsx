// Provider picker — only vendors with an implemented resource kind.
import React from "react";
import { Pressable } from "react-native";
import { router, Stack } from "expo-router";
import { availableVendors } from "@cloud-console/core/catalog";
import { Badge, Row, Screen, Section, Title } from "../../src/components/ui";
import { VENDOR_ICON } from "../../src/vendors";
import { useTheme, VENDOR_ACCENT } from "../../src/theme";
import { Text } from "react-native";

export default function AddCloud() {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text style={{ color: theme.tint, fontSize: 17 }}>Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Section>
          {availableVendors("mobile").map((v) => (
            <Row key={v.id} chevron onPress={() => router.push({ pathname: "/add/[vendor]", params: { vendor: v.id } })}>
              <Badge icon={VENDOR_ICON} color={VENDOR_ACCENT[v.id]} />
              <Title>{v.name}</Title>
            </Row>
          ))}
        </Section>
      </Screen>
    </>
  );
}
