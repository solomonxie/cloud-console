// Tapping a file: downloads it to cache; text and images show inline, video,
// audio, PDF and Office files open in Quick Look right away. Plus the
// single-file actions.
import React, { useCallback, useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Image, Platform, Pressable, Share, Text, View } from "react-native";
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

type Kind = "text" | "image" | "quicklook" | "other";

const KINDS: [Kind, RegExp][] = [
  ["image", /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|ico)$/i],
  ["quicklook", /\.(pdf|mp4|mov|m4v|mp3|m4a|wav|aac|docx?|xlsx?|pptx?|rtf|pages|numbers|key|usdz)$/i],
  ["text", /\.(txt|md|markdown|json|jsonl|ndjson|csv|tsv|log|xml|html?|css|s?js|mjs|cjs|tsx?|jsx|ya?ml|ini|conf|cfg|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sql|env|toml|tf|hcl|lock|gitignore|dockerfile|properties|srt|vtt)$/i],
];
const TEXT_LIMIT = 2_000_000;
const QUICKLOOK_ICON: Record<string, string> = { pdf: "doc.richtext", mp4: "film", mov: "film", m4v: "film", mp3: "waveform", m4a: "waveform", wav: "waveform", aac: "waveform", xls: "tablecells", xlsx: "tablecells", numbers: "tablecells" };

function kindOf(name: string): Kind {
  return KINDS.find(([, re]) => re.test(name))?.[0] ?? "other";
}

// Unknown extension: treat as text if the first 4 KB has no NUL byte.
function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.includes(0);
}

function head(f: File): Uint8Array {
  const handle = f.open();
  try {
    return handle.readBytesSync(4096);
  } finally {
    handle.close();
  }
}

export default function ObjectDetail() {
  const theme = useTheme();
  const { id, service, bucket, region } = useLocalSearchParams<{ id: string; service: StorageService; bucket: string; region: string }>();
  const object = useJsonParam<StorageObject>("object");
  const { session } = useSession();
  const [file, setFile] = useState<File>();
  const [text, setText] = useState<string>();
  const [aspect, setAspect] = useState(1);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const name = object ? displayName(object.key) : "";
  const kind = kindOf(name);

  const download = useCallback(async () => {
    if (!session || !object) return;
    setLoading(true);
    setError(undefined);
    try {
      const dir = new Directory(Paths.cache, "previews", newId());
      dir.create({ intermediates: true, idempotent: true });
      const f = new File(dir, name || "file");
      await cloud.downloadToFile(session, service, bucket, region, object.key, f);
      setFile(f);
      const small = (f.size ?? 0) <= TEXT_LIMIT;
      if (small && (kind === "text" || (kind === "other" && looksLikeText(head(f))))) setText(await f.text());
      else if (kind === "quicklook") void openQuickLook(f);
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [session, object?.key]);

  useEffect(() => {
    void download();
  }, [download]);

  const openQuickLook = async (f: File) => {
    try {
      if (await File.canPreview(f)) await File.preview(f, { title: name });
      else Alert.alert("No preview", "This file type can't be previewed on this device.");
    } catch (e) {
      Alert.alert("No preview", errorMessage(e));
    }
  };

  if (!object) return null;
  const target = { connectionID: id, service, bucket, region, key: object.key, isFolder: false };

  const quickLook = () => file && void openQuickLook(file);

  const shareLink = async () => {
    if (!session) return;
    try {
      const url = await cloud.presignedUrl(session, service, bucket, region, object.key);
      await Share.share({ url, message: Platform.OS === "ios" ? undefined : url });
    } catch (e) {
      Alert.alert("Couldn't make a link", errorMessage(e));
    }
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
      if (i === 0) void shareLink();
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
            <Pressable accessibilityLabel="Close" onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
              <Icon name="xmark" color={theme.text} size={17} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable accessibilityLabel="Actions" onPress={menu} hitSlop={10} style={{ padding: 6 }}>
              <Icon name="ellipsis" color={theme.text} size={17} />
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
          {kind === "image" && file ? (
            <Pressable onPress={quickLook} style={{ marginHorizontal: 16, marginBottom: 24 }}>
              <Image
                source={{ uri: file.uri }}
                resizeMode="contain"
                onLoad={(e) => e.nativeEvent.source.width && setAspect(e.nativeEvent.source.width / e.nativeEvent.source.height)}
                style={{ width: "100%", aspectRatio: aspect, maxHeight: 520, borderRadius: 10, backgroundColor: theme.card }}
              />
            </Pressable>
          ) : text === undefined ? (
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
              <Icon name={QUICKLOOK_ICON[name.split(".").pop()?.toLowerCase() ?? ""] ?? "doc.text.magnifyingglass"} color={theme.secondary} size={44} />
              <Button label="Open Preview" icon="eye" prominent onPress={quickLook} />
            </View>
          ) : null}
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
