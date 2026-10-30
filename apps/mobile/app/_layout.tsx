import React, { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { loadSettings, settings } from "../src/services/settings";
import { loadConnections } from "../src/state/connections";
import { lock, lockEnabled, lockState } from "../src/services/applock";
import { queue } from "../src/services/queue";
import { useStore } from "../src/state/store";
import { LockScreen } from "../src/screens/LockScreen";
import { useTheme } from "../src/theme";

export default function RootLayout() {
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const { locked } = useStore(lockState);
  const { demoOn, demoGeneration } = useStore(settings);

  useEffect(() => {
    void (async () => {
      await loadSettings();
      if (lockEnabled()) lock();
      await loadConnections();
      await queue.start();
      setReady(true);
    })();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") lock();
      if (state === "active") void queue.start();
    });
    return () => sub.remove();
  }, []);

  // Demo toggle / reset rebuilds the connection list (Swift: HomeView.id(...)).
  useEffect(() => {
    if (ready) void loadConnections();
  }, [demoOn, demoGeneration]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="auto" />
      {ready ? (
        <Stack
          screenOptions={{
            headerLargeTitle: false,
            headerBackButtonDisplayMode: "minimal",
            contentStyle: { backgroundColor: theme.background },
            headerStyle: { backgroundColor: theme.background },
            headerTintColor: theme.tint,
            headerTitleStyle: { color: theme.text },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ title: "Cloud Console", headerLargeTitle: true }} />
          <Stack.Screen name="add/index" options={{ presentation: "modal", title: "Add connection" }} />
          <Stack.Screen name="add/[vendor]" options={{ presentation: "modal" }} />
          <Stack.Screen name="operations" options={{ title: "Process Queue" }} />
          <Stack.Screen name="passcode-setup" options={{ presentation: "modal", title: "Passcode" }} />
          <Stack.Screen name="c/[id]/object" options={{ presentation: "modal" }} />
          <Stack.Screen name="c/[id]/destination" options={{ presentation: "modal", title: "Choose destination" }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, backgroundColor: theme.background }} />
      )}
      {locked ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <LockScreen />
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}
