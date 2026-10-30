// A service's resource list, a page at a time (port of ResourceListPage).
import React, { useState, type ReactNode } from "react";
import { Stack } from "expo-router";
import { plural } from "@cloud-console/core/format";
import { Button, Caption, Loading, Screen, Section, StatusBar, Unavailable } from "../components/ui";
import type { Loadable } from "../components/hooks";

const PAGE = 20;

export function ResourceList<T>({ title, icon, data, renderItem, keyOf }: { title: string; icon: string; data: Loadable<T[]>; renderItem: (item: T) => ReactNode; keyOf: (item: T) => string }) {
  const [visible, setVisible] = useState(PAGE);
  const items = data.value ?? [];
  let body: ReactNode;
  if (data.loading && items.length === 0) body = <Loading label={`Loading ${title.toLowerCase()}…`} />;
  else if (data.error)
    body = (
      <Screen>
        <Unavailable icon="exclamationmark.triangle" title={`Couldn't load ${title.toLowerCase()}`} message={data.error} action={{ label: "Retry", onPress: () => void data.reload(true) }} />
      </Screen>
    );
  else if (items.length === 0)
    body = (
      <Screen refreshing={data.loading} onRefresh={() => void data.reload(true)}>
        <Unavailable icon={icon} title={title} message="Nothing here yet." />
      </Screen>
    );
  else
    body = (
      <Screen
        refreshing={data.loading}
        onRefresh={() => void data.reload(true)}
        footer={
          <StatusBar>
            <Caption>{plural(items.length, "item")}</Caption>
          </StatusBar>
        }
      >
        <Section>
          {items.slice(0, visible).map((item) => (
            <React.Fragment key={keyOf(item)}>{renderItem(item)}</React.Fragment>
          ))}
          {items.length > visible ? <Button label={`Show more (${items.length - visible})`} onPress={() => setVisible(visible + PAGE)} /> : null}
        </Section>
      </Screen>
    );
  return (
    <>
      <Stack.Screen options={{ title }} />
      {body}
    </>
  );
}
