import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import type { EventBridgeItem } from "@cloud-console/core/events";
import type { ResourceDetail } from "@cloud-console/core/detail";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { CodeBlock, DetailRow, Muted, Screen, Section, Spinner } from "../../../src/components/ui";

export default function EventDetail() {
  const item = useJsonParam<EventBridgeItem>("item");
  const { session } = useSession();
  const [detail, setDetail] = useState<ResourceDetail>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!session || !item) return;
    cloud.eventDetail(session, item).then(setDetail, (e) => setError(errorMessage(e)));
  }, [session]);
  if (!item) return null;
  return (
    <>
      <Stack.Screen options={{ title: item.name }} />
      <Screen>
        {detail ? (
          <>
            <Section title="Details">
              {detail.fields.map((f) => (
                <DetailRow key={f.label} label={f.label} value={f.value} />
              ))}
            </Section>
            {detail.documents.map((d) => (
              <Section key={d.title} title={d.title}>
                <CodeBlock text={d.text} scroll={false} />
              </Section>
            ))}
          </>
        ) : (
          <Section>{error ? <Muted>{error}</Muted> : <Spinner />}</Section>
        )}
      </Screen>
    </>
  );
}
