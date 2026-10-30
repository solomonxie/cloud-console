// App-level Settings card at the bottom of Home — Face ID / passcode lock,
// process queue, demo mode.
import React, { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { settings, updateSettings } from "../services/settings";
import { biometricsAvailable, clearPasscode } from "../services/applock";
import { resetDemoConnections } from "../state/connections";
import { useOperations } from "../state/queueStore";
import { useStore } from "../state/store";
import { Badge, Button, Card, Icon, Row } from "../components/ui";
import { useTheme } from "../theme";

export function SettingsCard() {
  const theme = useTheme();
  const s = useStore(settings);
  const ops = useOperations();
  const active = ops.some((o) => o.status === "running");
  const [bioAvailable, setBioAvailable] = useState(false);
  useEffect(() => {
    void biometricsAvailable().then(setBioAvailable);
  }, []);

  const togglePasscode = (on: boolean) => {
    if (on) router.push("/passcode-setup");
    else
      Alert.alert("Turn off passcode?", undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Turn Off", style: "destructive", onPress: () => void clearPasscode() },
      ]);
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
        <Badge icon="lock.fill" color="#8E8E93" size={44} />
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Settings</Text>
          <Text style={{ color: theme.secondary, fontSize: 12 }}>Local protection for this app</Text>
        </View>
      </View>
      <Row>
        <Badge icon="faceid" color="#007AFF" size={34} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "500" }}>Face ID</Text>
          {!bioAvailable ? <Text style={{ color: theme.secondary, fontSize: 12 }}>Not available on this device</Text> : null}
        </View>
        <Switch value={s.faceIDEnabled} disabled={!bioAvailable} onValueChange={(v) => updateSettings({ faceIDEnabled: v })} />
      </Row>
      <Row>
        <Badge icon="number" color="#FF9500" size={34} />
        <Text style={{ flex: 1, color: theme.text, fontSize: 17, fontWeight: "500" }}>Passcode</Text>
        <Switch value={s.passcodeEnabled} onValueChange={togglePasscode} />
      </Row>
      {s.passcodeEnabled && s.passcodeHint ? (
        <Row>
          <Badge icon="lightbulb.fill" color="#FFCC00" size={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: "500" }}>Hint</Text>
            <Text style={{ color: theme.secondary, fontSize: 12 }}>{s.passcodeHint}</Text>
          </View>
          <Button label="Change" onPress={() => router.push("/passcode-setup")} />
        </Row>
      ) : null}
      <Row onPress={() => router.push("/operations")} chevron>
        <Badge icon={active ? "arrow.triangle.2.circlepath" : "list.bullet"} color="#34C759" size={34} />
        <Text style={{ flex: 1, color: theme.text, fontSize: 17, fontWeight: "500" }}>Process Queue</Text>
        {active ? <Icon name="circle.fill" color={theme.green} size={8} /> : null}
      </Row>
      <Row>
        <Badge icon="sparkles.rectangle.stack" color="#AF52DE" size={34} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "500" }}>Demo mode</Text>
          <Text style={{ color: theme.secondary, fontSize: 12 }}>Sample accounts, nothing sent to any cloud</Text>
        </View>
        <Switch value={s.demoOn} onValueChange={(v) => updateSettings({ demoOn: v })} />
      </Row>
      {s.demoOn ? (
        <Row
          onPress={() => {
            void resetDemoConnections().then(() => updateSettings({ demoGeneration: settings.get().demoGeneration + 1 }));
          }}
        >
          <Badge icon="arrow.counterclockwise" color="#AF52DE" size={34} />
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "500" }}>Reset demo data</Text>
        </Row>
      ) : null}
    </Card>
  );
}
