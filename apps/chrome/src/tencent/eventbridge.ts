// EventBridge (CEB): event buses and rules in Tencent's CEB regions, grouped
// by region; each opens its detail (fields, event pattern, targets).
import { eventBridgeItemId, type EventBridgeItem } from "@cloud-console/core/events";
import { connectionLabel } from "@cloud-console/core/storage/connection";
import * as ceb from "@cloud-console/core/tencent/eventbridge";
import { detailScreen } from "../app/detail-screen.ts";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav } from "../app/nav.ts";
import { regionalScreen } from "../app/regional-screen.ts";
import { favScope, tencentKey } from "./key.ts";

const KIND_ICONS: Record<EventBridgeItem["kind"], string> = { Rule: "gitBranch", Schedule: "clock", "Event bus": "inbox" };

function subtitle(item: EventBridgeItem): string {
  const parts: string[] = [item.kind];
  if (item.state) parts.push(item.state.charAt(0) + item.state.slice(1).toLowerCase());
  if (item.summary) parts.push(item.summary);
  return parts.join(" · ");
}

registerKindScreen("tencent", "tencentEventBridge", (conn) => {
  const key = tencentKey(conn);
  const label = connectionLabel(conn);
  return regionalScreen<EventBridgeItem>({
    title: "EventBridge",
    subtitle: label,
    noun: ["item", "items"],
    emptyIcon: "gitBranch",
    filterPlaceholder: "Filter buses and rules",
    favoritesScope: favScope(conn, "tencentEventBridge"),
    cacheKey: (region) => `tencent-eventbridge@${region}:${conn.id}`,
    regions: async () => ceb.CEB_REGIONS,
    fetch: (region) => ceb.listRegionItems(key, region),
    row: (item) => ({
      id: eventBridgeItemId(item),
      icon: KIND_ICONS[item.kind],
      title: item.name,
      subtitle: subtitle(item),
      search: item.container,
      open: () => nav.push(detailScreen({ title: item.name, subtitle: `${item.kind} · ${item.region}`, load: () => ceb.detail(key, item), refreshable: true })),
    }),
  });
});
