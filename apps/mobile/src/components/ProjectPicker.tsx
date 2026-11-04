// GCP project switcher shown atop every GCP list, like the Chrome extension's
// project combobox. Lists the account's projects, or takes a typed ID when the
// credential can't list any.
import React, { useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { errorMessage } from "@cloud-console/core/aws/errors";
import { gcpProjects, type Session } from "../services/cloud";
import { setProject } from "../state/connections";
import { Icon } from "./ui";
import { useTheme } from "../theme";

export function ProjectPicker({ session, connectionID }: { session?: Session; connectionID: string }) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);

  const typeID = () =>
    Alert.prompt("Project ID", "A project this credential can access.", (v) => {
      const id = v?.trim();
      if (id) void setProject(connectionID, id);
    }, "plain-text", session?.project);

  const open = async () => {
    if (!session) return;
    setLoading(true);
    const projects = await gcpProjects(session, false).catch((e: unknown) => {
      Alert.alert("Couldn't list projects", errorMessage(e));
      return [];
    });
    setLoading(false);
    const labels = projects.map((p) => (p.projectId === session.project ? "✓ " : "") + (p.name && p.name !== p.projectId ? `${p.name} (${p.projectId})` : p.projectId));
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Project", options: [...labels, "Enter project ID…", "Cancel"], cancelButtonIndex: labels.length + 1 },
      (i) => {
        if (i < projects.length) void setProject(connectionID, projects[i]!.projectId);
        else if (i === projects.length) typeID();
      }
    );
  };

  return (
    <Pressable accessibilityLabel="Change project" onPress={() => void open()} style={({ pressed }) => ({ marginHorizontal: 16, marginTop: 8, marginBottom: 4, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Icon name="folder.fill" color={theme.secondary} size={14} />
        <Text style={{ color: theme.secondary, fontSize: 15 }}>Project</Text>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, flex: 1 }}>{session?.project || "None selected"}</Text>
        {loading ? <ActivityIndicator size="small" /> : <Icon name="chevron.up.chevron.down" color={theme.tint} size={13} />}
      </View>
    </Pressable>
  );
}
