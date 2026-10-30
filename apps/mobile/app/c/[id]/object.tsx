// Tapping a file: downloads it to cache, previews it with the system Quick
// Look viewer, and offers the single-file actions.
import React, { useCallback, useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, Share, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Directory, File, Paths } from "expo-file-system";
import { byteCount, formatDateTime } from "@cloud-console/core/format";
import { storageClassLabel } from "@cloud-console/core/aws/s3-buckets";
import { displayName, type StorageService } from "@cloud-console/core/object-store";
import { errorMessage } from "@cloud-console/core/aws/errors";
import type { StorageObject } from "@cloud-console/core/storage/types";
import * as cloud from "../../../src/services/cloud";
import { queue } from "../../../src/services/queue";
import { awaitDestination } from "../../../src/state/destination";
import { newId } from "../../../src/state/connections";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { Button, CodeBlock, DetailRow, Icon, Loading, Screen, Section, Unavailable } from "../../../src/components/ui";
import { nav } from "../../../src/nav";
import { useTheme } from "../../../src/theme";

const TEXT_EXT = /\.(txt|md|json|csv|log|xml|html?|css|js|ts|ya?ml|ini|conf|sh|py|sql|env|toml)$/i;

export default function ObjectDetail() {
  const theme = useTheme();
  const { id, service, bucket, region } = useLocalSearchParams<{ id: string; service: StorageService; bucket: string; region: string }>();
  const object = useJsonParam<StorageObject>("object");
  const { session } = useSession();
  const [file, setFile] = useState<File>();
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const name = object ? displayName(object.key) : "";

  const download = useCallback(async () => {
    if (!session || !object) return;
    setLoading(true);
    setError(undefined);
    try {
      const data = await cloud.downloadObject(session, service, bucket, region, object.key);
      const dir = new Directory(Paths.cache, "previews", newId());
      dir.create({ intermediates: true, idempotent: true });
      const f = new File(dir, name || "file");
      f.create({ overwrite: true });
      await f.write(typeof data === "string" ? data : new Uint8Array(data));
      setFile(f);
      if (typeof data === "string" || TEXT_EXT.test(name)) setText(typeof data === "string" ? data : await f.text());
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [session, object?.key]);

  useEffect(() => {
    void download();
  }, [download]);

  if (!object) return null;
  const target = { connectionID: id, service, bucket, region, key: object.key, isFolder: false };

  const quickLook = async () => {
    if (!file) return;
    try {
      if (await File.canPreview(file)) await File.preview(file, { title: name });
      else Alert.alert("No preview", "This file type can't be previewed on this device.");
    } catch (e) {
      Alert.alert("No preview", errorMessage(e));
    }
  };

  const shareLink = () => {
    if (!session) return;
    void Share.share({ url: cloud.presignedUrl(session, service, bucket, region, object.key), message: Platform.OS === "ios" ? undefined : cloud.presignedUrl(session, service, bucket, region, object.key) });
  };

  const transfer = (kind: "copy" | "move") => {
    const token = awaitDestination((d) => {
      queue.enqueueTransfer(kind, { ...target, destinationBucket: d.bucket, destinationRegion: d.region, destinationPrefix: d.prefix });
      if (kind === "move") router.back();
    });
    nav.destination(id, service, bucket, region, token);
  };

  const menu = () => {
    const options = ["Share Link", "Rename", "Duplicate", "Copy to…", "Move to…", "Delete", "Cancel"];
    const run = (i: number) => {
      if (i === 0) shareLink();
      else if (i === 1)
        Alert.prompt("Rename", undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Rename", onPress: (n?: string) => { if (n) { queue.enqueueRename({ ...target, newName: n }); router.back(); } } },
        ], "plain-text", name);
      else if (i === 2) queue.enqueueCopy(target);
      else if (i === 3) transfer("copy");
      else if (i === 4) transfer("move");
      else if (i === 5)
        Alert.alert(`Delete ${name}?`, undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => { queue.enqueueDelete(target); router.back(); } },
        ]);
    };
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 5, cancelButtonIndex: 6 }, run);
    else Alert.alert(name, undefined, options.slice(0, 6).map((t, i) => ({ text: t, onPress: () => run(i) })));
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: name,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{ color: theme.tint, fontSize: 17 }}>Close</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable accessibilityLabel="Actions" onPress={menu} hitSlop={8}>
              <Icon name="ellipsis.circle" color={theme.tint} size={20} />
            </Pressable>
          ),
        }}
      />
      {loading && !file ? (
        <Loading label="Loading preview…" />
      ) : error ? (
        <Screen>
          <Unavailable icon="exclamationmark.triangle" title="Couldn't load preview" message={error} action={{ label: "Retry", onPress: () => void download() }} />
        </Screen>
      ) : (
        <Screen>
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
            <Icon name="doc.text.magnifyingglass" color={theme.secondary} size={44} />
            <Button label="Open Preview" icon="eye" prominent onPress={() => void quickLook()} />
          </View>
          {text !== undefined ? (
            <Section title="Contents">
              <CodeBlock text={text.length > 20000 ? `${text.slice(0, 20000)}\n…` : text} scroll={false} />
            </Section>
          ) : null}
          <Section title="Details">
            <DetailRow label="Key" value={object.key} />
            <DetailRow label="Size" value={byteCount(object.size)} />
            <DetailRow label="Storage class" value={storageClassLabel(object.storageClass)} />
            {object.lastModified ? <DetailRow label="Modified" value={formatDateTime(object.lastModified)} /> : null}
            <DetailRow label="Bucket" value={bucket} />
            <DetailRow label="Region" value={region} />
          </Section>
        </Screen>
      )}
    </>
  );
}
