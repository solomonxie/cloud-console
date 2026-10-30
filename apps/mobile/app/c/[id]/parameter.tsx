// SSM parameter: value (SecureString revealed on tap, never cached) + details.
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { Stack } from "expo-router";
import { isSecure, parameterDetailFields, type SSMParameter } from "@cloud-console/core/aws/parameter-store";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { DetailRow, LinkRow, Muted, Screen, Section, Spinner } from "../../../src/components/ui";
import { MONO, useTheme } from "../../../src/theme";
import { Pressable } from "react-native";
import * as Clipboard from "expo-clipboard";

export default function ParameterDetail() {
  const theme = useTheme();
  const parameter = useJsonParam<SSMParameter>("parameter");
  const { session } = useSession();
  const [value, setValue] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const fetch = async () => {
    if (!session || !parameter) return;
    setLoading(true);
    setError(undefined);
    try {
      setValue(await cloud.parameterValue(session, parameter));
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (parameter && !isSecure(parameter) && value === undefined) void fetch();
  }, [session]);

  if (!parameter) return null;
  return (
    <>
      <Stack.Screen options={{ title: parameter.name }} />
      <Screen>
        <Section title="Value">
          {value !== undefined ? (
            <Pressable onLongPress={() => void Clipboard.setStringAsync(value)} style={{ padding: 12 }}>
              <Text selectable style={{ fontFamily: MONO, fontSize: 15, color: theme.text }}>
                {value || " "}
              </Text>
            </Pressable>
          ) : loading ? (
            <Spinner />
          ) : isSecure(parameter) ? (
            <LinkRow label="Reveal" icon="eye" onPress={() => void fetch()} />
          ) : null}
          {error ? <Muted>{error}</Muted> : null}
        </Section>
        <Section title="Details">
          {parameterDetailFields(parameter).map((f) => (
            <DetailRow key={f.label} label={f.label} value={f.value} />
          ))}
        </Section>
      </Screen>
    </>
  );
}
