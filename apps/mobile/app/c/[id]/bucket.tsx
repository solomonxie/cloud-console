// Folder/object browser with select mode, upload, swipe/long-press actions
// (rename, duplicate, copy/move to, delete) — all writes go through the queue.
import React, { useCallback, useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { byteCount, plural } from "@cloud-console/core/format";
import { storageClassLabel } from "@cloud-console/core/aws/s3-buckets";
import { displayName, type StorageService } from "@cloud-console/core/object-store";
import { errorMessage } from "@cloud-console/core/aws/errors";
import type { ListPage, StorageObject } from "@cloud-console/core/storage/types";
import * as cloud from "../../../src/services/cloud";
import { queue, stageAndUpload } from "../../../src/services/queue";
import { awaitDestination } from "../../../src/state/destination";
import { useSession } from "../../../src/components/hooks";
import { Button, Caption, Icon, Loading, Row, Screen, Section, StatusBar, Unavailable } from "../../../src/components/ui";
import { nav } from "../../../src/nav";
import { useTheme } from "../../../src/theme";

const OBJECT_PAGE = 100;

export default function BucketObjects() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; service: StorageService; bucket: string; region: string; prefix?: string }>();
  const { id, service, bucket, region } = params;
  const prefix = params.prefix ?? "";
  const { session } = useSession();
  const [result, setResult] = useState<ListPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [visible, setVisible] = useState(OBJECT_PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(undefined);
    setVisible(OBJECT_PAGE);
    try {
      setResult(await cloud.listObjects(session, service, bucket, region, prefix));
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [session, service, bucket, region, prefix]);

  useEffect(() => {
    void load();
  }, [load]);

  const target = { connectionID: id, service, bucket, region };
  const drop = (keys: string[]) =>
    setResult((r) => (r ? { folders: r.folders.filter((f) => !keys.includes(f)), objects: r.objects.filter((o) => !keys.includes(o.key)) } : r));

  const confirmDelete = (key: string, isFolder: boolean) =>
    Alert.alert(`Delete ${displayName(key)}?`, isFolder ? "Deletes everything inside this folder. This runs in the background and can't be undone." : "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          queue.enqueueDelete({ ...target, key, isFolder });
          drop([key]);
        },
      },
    ]);

  const rename = (key: string, isFolder: boolean) =>
    Alert.prompt(
      "Rename",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Rename", onPress: (newName?: string) => newName && queue.enqueueRename({ ...target, key, isFolder, newName }) },
      ],
      "plain-text",
      displayName(key)
    );

  const transfer = (key: string, isFolder: boolean, kind: "copy" | "move") => {
    const token = awaitDestination((d) => {
      queue.enqueueTransfer(kind, { ...target, key, isFolder, destinationBucket: d.bucket, destinationRegion: d.region, destinationPrefix: d.prefix });
      if (kind === "move") drop([key]);
    });
    nav.destination(id, service, bucket, region, token);
  };

  const actions = (key: string, isFolder: boolean) => {
    const options = ["Rename", "Duplicate", "Copy to…", "Move to…", "Delete", "Cancel"];
    const run = (i: number) => {
      if (i === 0) rename(key, isFolder);
      else if (i === 1) queue.enqueueCopy({ ...target, key, isFolder });
      else if (i === 2) transfer(key, isFolder, "copy");
      else if (i === 3) transfer(key, isFolder, "move");
      else if (i === 4) confirmDelete(key, isFolder);
    };
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ title: displayName(key), options, destructiveButtonIndex: 4, cancelButtonIndex: 5 }, run);
    else Alert.alert(displayName(key), undefined, options.slice(0, 5).map((text, i) => ({ text, onPress: () => run(i) })));
  };

  const upload = () => {
    const pickPhotos = async () => {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, quality: 1 });
      if (r.canceled) return;
      const stamp = Math.floor(Date.now() / 1000);
      await stageAndUpload(
        { ...target, destinationPrefix: prefix },
        r.assets.map((a, i) => ({ uri: a.uri, fileName: a.fileName ?? `Photo-${stamp}-${i}.${a.uri.split(".").pop() ?? "jpg"}` }))
      );
    };
    const pickFiles = async () => {
      const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return;
      await stageAndUpload({ ...target, destinationPrefix: prefix }, r.assets.map((a) => ({ uri: a.uri, fileName: a.name })));
    };
    const run = (i: number) => {
      const job = i === 0 ? pickPhotos() : i === 1 ? pickFiles() : undefined;
      job?.catch((e) => Alert.alert("Upload Failed", errorMessage(e)));
    };
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: ["Photos", "Files", "Cancel"], cancelButtonIndex: 2 }, run);
    else Alert.alert("Upload", undefined, [{ text: "Photos", onPress: () => run(0) }, { text: "Files", onPress: () => run(1) }]);
  };

  const batchDelete = () =>
    Alert.alert(`Delete ${plural(selected.size, "item")}?`, "Folders are deleted with everything inside them. This runs in the background and can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          for (const key of selected) queue.enqueueDelete({ ...target, key, isFolder: !!result?.folders.includes(key) });
          drop([...selected]);
          setSelected(new Set());
          setSelecting(false);
        },
      },
    ]);

  /** Presigned links: local signing only, no network or queue. */
  const batchShare = async () => {
    if (!session) return;
    const keys = [...selected].filter((k) => result?.objects.some((o) => o.key === k)).sort();
    if (keys.length === 0) return;
    await Clipboard.setStringAsync(keys.map((k) => cloud.presignedUrl(session, service, bucket, region, k)).join("\n"));
    Alert.alert("Links Copied", `${plural(keys.length, "link")} copied to the clipboard. Each is valid for 1 hour.`);
    setSelected(new Set());
    setSelecting(false);
  };

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const hasItems = !!result && (result.folders.length > 0 || result.objects.length > 0);
  const title = prefix ? displayName(prefix) : bucket;

  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: () => (
          <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
            {!selecting ? (
              <Pressable accessibilityLabel="Upload" onPress={upload} hitSlop={8}>
                <Icon name="square.and.arrow.up.on.square" color={theme.tint} size={20} />
              </Pressable>
            ) : null}
            {hasItems ? (
              <Pressable onPress={() => { setSelecting(!selecting); setSelected(new Set()); }} hitSlop={8}>
                <Text style={{ color: theme.tint, fontSize: 17 }}>{selecting ? "Cancel" : "Select"}</Text>
              </Pressable>
            ) : null}
          </View>
        ),
      }}
    />
  );

  if (loading && !result) return <>{header}<Loading /></>;
  if (error)
    return (
      <>
        {header}
        <Screen>
          <Unavailable icon="exclamationmark.triangle" title="Couldn't load this folder" message={error} action={{ label: "Retry", onPress: () => void load() }} />
        </Screen>
      </>
    );
  if (!result || !hasItems)
    return (
      <>
        {header}
        <Screen refreshing={loading} onRefresh={() => void load()}>
          <Unavailable icon="tray" title="Empty" message="Nothing at this path." />
        </Screen>
      </>
    );

  const totalBytes = result.objects.reduce((n, o) => n + o.size, 0);
  const stats = [result.folders.length ? plural(result.folders.length, "folder") : undefined, plural(result.objects.length, "item"), totalBytes ? byteCount(totalBytes) : undefined]
    .filter(Boolean)
    .join(" · ");
  const canShare = [...selected].some((k) => result.objects.some((o) => o.key === k));

  const footer = selecting ? (
    <StatusBar>
      <View style={{ flexDirection: "row", alignItems: "center", flex: 1, paddingHorizontal: 16, gap: 16 }}>
        <Caption style={{ flex: 1 }}>{`${selected.size} selected`}</Caption>
        <Button label="Share" icon="square.and.arrow.up" disabled={!canShare} onPress={() => void batchShare()} />
        <Button label="Delete" icon="trash" destructive disabled={selected.size === 0} onPress={batchDelete} />
      </View>
    </StatusBar>
  ) : (
    <StatusBar>
      <Caption>{stats}</Caption>
    </StatusBar>
  );

  const check = (key: string) => (selecting ? <Icon name={selected.has(key) ? "checkmark.circle.fill" : "circle"} color={selected.has(key) ? theme.tint : theme.secondary} size={20} /> : null);

  return (
    <>
      {header}
      <Screen refreshing={loading} onRefresh={() => void load()} footer={footer}>
        <Section>
          {result.folders.map((folder) => (
            <Row
              key={folder}
              chevron={!selecting}
              onPress={() => (selecting ? toggle(folder) : nav.bucket(id, service, bucket, region, folder))}
              onLongPress={selecting ? undefined : () => actions(folder, true)}
            >
              {check(folder)}
              <Icon name="folder.fill" color="#1E9BF0" size={20} />
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, color: theme.text, fontSize: 17 }}>
                {displayName(folder)}
              </Text>
            </Row>
          ))}
          {result.objects.slice(0, visible).map((object: StorageObject) => (
            <Row
              key={object.key}
              onPress={() => (selecting ? toggle(object.key) : nav.object(id, service, bucket, region, object))}
              onLongPress={selecting ? undefined : () => actions(object.key, false)}
            >
              {check(object.key)}
              <Icon name="doc" color={theme.tint} size={20} />
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, color: theme.text, fontSize: 17 }}>
                {displayName(object.key)}
              </Text>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Caption>{byteCount(object.size)}</Caption>
                <Caption>{storageClassLabel(object.storageClass)}</Caption>
              </View>
            </Row>
          ))}
          {result.objects.length > visible ? <Button label={`Load more (${result.objects.length - visible})`} onPress={() => setVisible(visible + OBJECT_PAGE)} /> : null}
        </Section>
      </Screen>
    </>
  );
}
