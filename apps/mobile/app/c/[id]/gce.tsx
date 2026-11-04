// Compute Engine VM: details plus start / stop / reset (confirmed first;
// the credential's own IAM decides whether they work).
import React, { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { InstanceAction, InstanceSummary } from "@cloud-console/core/gcp/compute";
import { fields } from "@cloud-console/core/detail";
import { formatDateTime } from "@cloud-console/core/format";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { DetailRow, LinkRow, Muted, Screen, Section } from "../../../src/components/ui";
import { gceStatus } from "../../../src/gcpLabels";
import { useTheme } from "../../../src/theme";

const CONFIRM: Record<InstanceAction, { title: string; message: string; button: string }> = {
  start: { title: "Start", message: "Billing for the VM resumes while it runs.", button: "Start" },
  stop: { title: "Stop", message: "Shuts the VM down. Data on the boot disk is kept; local SSDs are lost.", button: "Stop" },
  reset: { title: "Reset", message: "Hard-resets the VM like pressing a reset button — unsaved data in memory is lost.", button: "Reset" },
};

export default function GCEDetail() {
  const theme = useTheme();
  const initial = useJsonParam<InstanceSummary>("instance");
  const { session } = useSession();
  const [instance, setInstance] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  if (!instance) return null;

  const refresh = async () => {
    if (!session) return;
    try {
      setInstance(await cloud.gceInstance(session, instance));
    } catch (e) {
      setNote(errorMessage(e));
    }
  };

  const act = (action: InstanceAction) => {
    const c = CONFIRM[action];
    Alert.alert(`${c.title} ${instance.name}?`, c.message, [
      { text: "Cancel", style: "cancel" },
      {
        text: c.button,
        style: action === "start" ? "default" : "destructive",
        onPress: async () => {
          if (!session) return;
          setBusy(true);
          setNote(undefined);
          try {
            await cloud.gceAction(session, instance, action);
            setNote(`${c.title} requested. Pull to refresh for the new status.`);
          } catch (e) {
            setNote(errorMessage(e));
          }
          setBusy(false);
        },
      },
    ]);
  };

  const running = instance.status === "RUNNING";
  return (
    <>
      <Stack.Screen options={{ title: instance.name }} />
      <Screen refreshing={false} onRefresh={() => void refresh()}>
        <Section title="Details">
          {fields([
            ["Status", gceStatus(instance.status)],
            ["Machine type", instance.machineTypeName],
            ["Zone", instance.zoneName],
            ["Internal IP", instance.internalIp],
            ["External IP", instance.externalIp],
            ["Created", instance.creationTimestamp ? formatDateTime(instance.creationTimestamp) : undefined],
            ["Last started", instance.lastStartTimestamp ? formatDateTime(instance.lastStartTimestamp) : undefined],
            ["Last stopped", instance.lastStopTimestamp ? formatDateTime(instance.lastStopTimestamp) : undefined],
            ["Service account", instance.serviceAccounts?.[0]?.email],
          ]).map((f) => (
            <DetailRow key={f.label} label={f.label} value={f.value} />
          ))}
        </Section>
        <Section title="Actions" footer="Needs Compute Instance Admin on this project.">
          <LinkRow label="Start" icon="play.fill" disabled={busy || running} onPress={() => act("start")} />
          <LinkRow label="Stop" icon="stop.fill" color={theme.red} disabled={busy || !running} onPress={() => act("stop")} />
          <LinkRow label="Reset" icon="arrow.counterclockwise" color={theme.red} disabled={busy || !running} onPress={() => act("reset")} />
          {note ? <Muted>{note}</Muted> : null}
        </Section>
      </Screen>
    </>
  );
}
