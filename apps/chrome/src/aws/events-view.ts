// EventBridge (rules, Scheduler schedules, event buses) in every enabled
// region, grouped by region, and an item page like the mobile app's
// event.tsx — detail fields plus JSON documents (pattern, targets, policy).
import { detail, listItems } from "@cloud-console/core/aws/eventbridge";
import { eventBridgeItemId, type EventBridgeItem } from "@cloud-console/core/events";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav, type Screen } from "../app/nav.ts";
import { statusLine } from "../gcp/dom.ts";
import { awsKey, describe } from "./common.ts";
import { codeBlock, detailList, regionalListScreen, screenSubtitle, section, statePill } from "./ui.ts";

const KIND_ICONS: Record<EventBridgeItem["kind"], string> = { Rule: "gitBranch", Schedule: "clock", "Event bus": "inbox" };

registerKindScreen("aws", "eventBridge", (conn) =>
  regionalListScreen<EventBridgeItem>({
    conn,
    kind: "eventBridge",
    cacheKind: "eventbridge",
    title: "EventBridge",
    noun: ["item", "items"],
    filter: "Filter by name, bus, target…",
    emptyIcon: "gitBranch",
    fetch: (region) => listItems(awsKey(conn), region),
    row: (item) => ({
      icon: KIND_ICONS[item.kind],
      title: item.name,
      subtitle: [item.kind, item.summary].filter(Boolean).join(" · "),
      pill: statePill(item.state),
      search: [item.kind, item.name, item.container, item.state, item.summary, item.region].join(" "),
      favId: eventBridgeItemId(item),
      onOpen: () => nav.push(eventScreen(conn, item)),
    }),
  })
);

function eventScreen(conn: StorageConnection, item: EventBridgeItem): Screen {
  let alive = true;
  return {
    title: item.name,
    subtitle: screenSubtitle(conn, item.region),
    render(body) {
      body.classList.add("gcp-detail");
      const holder = section("Details", statusLine("loading", "Loading…"));
      body.append(holder);
      void detail(awsKey(conn), item).then(
        (d) => {
          if (!alive) return;
          holder.replaceWith(section("Details", detailList(d.fields)), ...d.documents.map((doc) => section(doc.title, codeBlock(doc.text))));
        },
        (err) => {
          if (alive) holder.replaceWith(section("Details", statusLine("error", describe(err, "Couldn't load details"))));
        }
      );
    },
    onLeave() {
      alive = false;
    },
  };
}
