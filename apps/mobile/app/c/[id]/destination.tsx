// Pick a destination bucket + folder for Copy to… / Move to…. Starts at the
// source bucket's root; "All buckets" switches to another bucket of the same
// connection.
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { displayName, type StorageService } from "@cloud-console/core/object-store";
import { errorMessage } from "@cloud-console/core/aws/errors";
import type { Bucket } from "@cloud-console/core/aws/s3-buckets";
import * as cloud from "../../../src/services/cloud";
import { resolveDestination } from "../../../src/state/destination";
import { useSession } from "../../../src/components/hooks";
import { Button, Caption, Icon, Muted, Row, Screen, Section, Spinner } from "../../../src/components/ui";
import { useTheme } from "../../../src/theme";

export default function DestinationPicker() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ service: StorageService; bucket: string; region: string; token: string }>();
  const { session } = useSession();
  const [bucket, setBucket] = useState<{ name: string; region: string } | undefined>({ name: params.bucket, region: params.region });
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState<string[]>();
  const [buckets, setBuckets] = useState<Bucket[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!session) return;
    setError(undefined);
    if (bucket) {
      setFolders(undefined);
      cloud.listObjects(session, params.service, bucket.name, bucket.region, prefix).then((r) => setFolders(r.folders), (e) => setError(errorMessage(e)));
    } else {
      cloud.listBuckets(session, params.service, false).then(setBuckets, (e) => setError(errorMessage(e)));
    }
  }, [session, bucket?.name, prefix]);

  const choose = () => {
    if (!bucket) return;
    resolveDestination(params.token, { bucket: bucket.name, region: bucket.region, prefix });
    router.back();
  };

  const up = () => {
    if (!prefix) return setBucket(undefined);
    const trimmed = prefix.slice(0, -1);
    const slash = trimmed.lastIndexOf("/");
    setPrefix(slash >= 0 ? trimmed.slice(0, slash + 1) : "");
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{ color: theme.tint, fontSize: 17 }}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () =>
            bucket ? (
              <Pressable onPress={choose} hitSlop={8}>
                <Text style={{ color: theme.tint, fontSize: 17, fontWeight: "600" }}>Choose</Text>
              </Pressable>
            ) : null,
        }}
      />
      <Screen>
        <View style={{ marginHorizontal: 32, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Caption style={{ flex: 1 }}>{bucket ? `${bucket.name}/${prefix}` : "All buckets"}</Caption>
          {bucket ? <Button label={prefix ? "Up" : "All buckets"} icon="chevron.left" onPress={up} /> : null}
        </View>
        {error ? (
          <Section>
            <Muted>{error}</Muted>
          </Section>
        ) : bucket ? (
          <Section footer="Copies keep their names; choose a folder, then tap Choose.">
            {folders === undefined ? <Spinner /> : null}
            {folders?.length === 0 ? <Muted>No folders here.</Muted> : null}
            {folders?.map((f) => (
              <Row key={f} chevron onPress={() => setPrefix(f)}>
                <Icon name="folder.fill" color="#1E9BF0" size={20} />
                <Text style={{ flex: 1, color: theme.text, fontSize: 17 }} numberOfLines={1}>
                  {displayName(f)}
                </Text>
              </Row>
            ))}
          </Section>
        ) : (
          <Section>
            {buckets === undefined ? <Spinner /> : null}
            {buckets?.map((b) => (
              <Row key={b.name} chevron onPress={() => { setPrefix(""); setBucket({ name: b.name, region: b.region ?? params.region }); }}>
                <Icon name="archivebox.fill" color={theme.tint} size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17 }} numberOfLines={1}>{b.name}</Text>
                  {b.region ? <Caption>{b.region}</Caption> : null}
                </View>
              </Row>
            ))}
          </Section>
        )}
      </Screen>
    </>
  );
}
