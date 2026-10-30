// IAM/CAM user or role: details and policies; each policy fetches its JSON
// document only when expanded.
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { IAMRole, IAMUser } from "@cloud-console/core/aws/iam";
import { formatDate } from "@cloud-console/core/format";
import { prettyJsonString } from "@cloud-console/core/detail";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { Caption, CodeBlock, DetailRow, Disclosure, Muted, Screen, Section, Spinner } from "../../../src/components/ui";
import { useTheme } from "../../../src/theme";

type Principal = Partial<IAMUser & IAMRole> & { arn: string; path: string; createDate?: string };

export default function PrincipalDetail() {
  const { kind } = useLocalSearchParams<{ kind: "user" | "role" }>();
  const item = useJsonParam<Principal>("item");
  const { session } = useSession();
  const [policies, setPolicies] = useState<{ attached: cloud.PolicyRef[]; inline?: cloud.PolicyRef[] }>();
  const [error, setError] = useState<string>();
  const name = (kind === "user" ? item?.userName : item?.roleName) ?? "";

  useEffect(() => {
    if (!session || !item) return;
    cloud.principalPolicies(session, kind, name, item.arn).then(setPolicies, (e) => setError(errorMessage(e)));
  }, [session, item?.arn]);

  if (!item) return null;
  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <Screen>
        <Section title="Details">
          <DetailRow label={kind === "user" ? "User name" : "Role name"} value={name} />
          <DetailRow label="ARN" value={item.arn} />
          <DetailRow label="Path" value={item.path} />
          {item.createDate ? <DetailRow label="Created" value={formatDate(item.createDate)} /> : null}
        </Section>
        <Section title="Attached policies">
          {!policies && !error ? <Spinner /> : null}
          {error ? <Muted>{error}</Muted> : null}
          {policies && policies.attached.length === 0 ? <Muted>No attached policies</Muted> : null}
          {policies?.attached.map((p) => <PolicyRow key={p.title + (p.subtitle ?? "")} policy={p} />)}
        </Section>
        {policies?.inline ? (
          <Section title="Inline policies">
            {policies.inline.length === 0 ? <Muted>No inline policies</Muted> : null}
            {policies.inline.map((p) => <PolicyRow key={p.title} policy={p} />)}
          </Section>
        ) : null}
      </Screen>
    </>
  );
}

function PolicyRow({ policy }: { policy: cloud.PolicyRef }) {
  const theme = useTheme();
  const [doc, setDoc] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const fetch = () => {
    if (doc !== undefined || loading) return;
    setLoading(true);
    policy.load().then(
      (d) => setDoc(prettyJsonString(d)),
      (e) => setError(errorMessage(e))
    ).finally(() => setLoading(false));
  };
  return (
    <Disclosure
      onToggle={(open) => open && fetch()}
      label={
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.text, fontSize: 17 }}>{policy.title}</Text>
          {policy.subtitle ? <Caption numberOfLines={1}>{policy.subtitle}</Caption> : null}
        </View>
      }
    >
      {loading ? <Spinner /> : error ? <Muted>{error}</Muted> : doc !== undefined ? <CodeBlock text={doc} /> : null}
    </Disclosure>
  );
}
