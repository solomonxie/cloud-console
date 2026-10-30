// Plain field-list page shared by the simpler resource kinds (CVM).
import React from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import type { DetailField } from "@cloud-console/core/detail";
import { useJsonParam } from "../../../src/components/hooks";
import { DetailRow, Screen, Section } from "../../../src/components/ui";

export default function KeyValueDetail() {
  const { title } = useLocalSearchParams<{ title: string }>();
  const fields = useJsonParam<DetailField[]>("fields") ?? [];
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen>
        <Section title="Details">
          {fields.map((f) => (
            <DetailRow key={f.label} label={f.label} value={f.value} />
          ))}
        </Section>
      </Screen>
    </>
  );
}
