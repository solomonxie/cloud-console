// Secret Manager secret: latest value revealed on tap, never cached.
import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import { Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { SecretSummary } from "@cloud-console/core/gcp/secrets";
import { fields } from "@cloud-console/core/detail";
import { formatDateTime } from "@cloud-console/core/format";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { DetailRow, LinkRow, Muted, Screen, Section, Spinner } from "../../../src/components/ui";
import { MONO, useTheme } from "../../../src/theme";

export default function SecretDetail() {
  const theme = useTheme();
  const secret = useJsonParam<SecretSummary>("secret");
  const { session } = useSession();
  const [value, setValue] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  if (!secret) return null;

  const reveal = async () => {
    if (!session) return;
    setLoading(true);
    setError(undefined);
    try {
      setValue(await cloud.secretValue(session, secret.secretId));
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  };

  return (
    <>
      <Stack.Screen options={{ title: secret.secretId }} />
      <Screen>
        <Section title="Latest version" footer={value !== undefined ? "Long-press to copy." : "Needs Secret Manager Secret Accessor."}>
          {value !== undefined ? (
            <Pressable onLongPress={() => void Clipboard.setStringAsync(value)} style={{ padding: 12 }}>
              <Text selectable style={{ fontFamily: MONO, fontSize: 15, color: theme.text }}>
                {value || " "}
              </Text>
            </Pressable>
          ) : loading ? (
            <Spinner />
          ) : (
            <LinkRow label="Reveal" icon="eye" onPress={() => void reveal()} />
          )}
          {error ? <Muted>{error}</Muted> : null}
        </Section>
        <Section title="Details">
          {fields([
            ["Name", secret.name],
            ["Created", secret.createTime ? formatDateTime(secret.createTime) : undefined],
            ["Expires", secret.expireTime ? formatDateTime(secret.expireTime) : undefined],
            ["Replication", secret.replication?.automatic ? "Automatic" : secret.replication?.userManaged?.replicas?.map((r) => r.location).join(", ")],
          ]).map((f) => (
            <DetailRow key={f.label} label={f.label} value={f.value} />
          ))}
        </Section>
      </Screen>
    </>
  );
}
