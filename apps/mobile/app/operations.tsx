// Process Queue: every queued storage write, with progress, retry and clear.
import React from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { completedCount, isFinished, type StorageOperation } from "@cloud-console/core/operation-queue";
import { formatDateTime } from "@cloud-console/core/format";
import { queue } from "../src/services/queue";
import { useOperations } from "../src/state/queueStore";
import { Button, Caption, Icon, Screen, Section, Unavailable } from "../src/components/ui";
import { useTheme } from "../src/theme";

export default function Operations() {
  const theme = useTheme();
  const ops = useOperations();
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            ops.some(isFinished) ? (
              <Pressable onPress={() => queue.clearFinished()} hitSlop={8}>
                <Text style={{ color: theme.tint, fontSize: 17 }}>Clear</Text>
              </Pressable>
            ) : null,
        }}
      />
      <Screen>
        {ops.length === 0 ? (
          <Unavailable icon="list.bullet" title="No operations" message="Deletes, copies, moves, renames and uploads show up here while they run." />
        ) : (
          <Section>
            {ops.map((op) => (
              <OperationRow key={op.id} op={op} />
            ))}
          </Section>
        )}
      </Screen>
    </>
  );
}

function OperationRow({ op }: { op: StorageOperation }) {
  const theme = useTheme();
  const total = op.items.length;
  const done = completedCount(op);
  const icon = op.status === "completed" ? "checkmark.circle.fill" : op.status === "failed" ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath";
  const color = op.status === "completed" ? theme.green : op.status === "failed" ? theme.orange : theme.tint;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 11, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name={icon} color={color} size={18} />
        <Text style={{ flex: 1, color: theme.text, fontSize: 17 }} numberOfLines={2}>
          {op.label}
        </Text>
      </View>
      {total > 0 ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.fill, overflow: "hidden" }}>
          <View style={{ width: `${(done / total) * 100}%`, height: 4, backgroundColor: color }} />
        </View>
      ) : null}
      <Caption>{`${op.bucket} · ${total > 0 ? `${done}/${total}` : op.status === "running" ? "Listing…" : "0 items"} · ${formatDateTime(op.createdAt)}`}</Caption>
      {op.errorMessage ? <Caption color={theme.orange}>{op.errorMessage}</Caption> : null}
      {op.status === "failed" ? <Button label="Retry" icon="arrow.clockwise" onPress={() => queue.retry(op.id)} /> : null}
    </View>
  );
}
