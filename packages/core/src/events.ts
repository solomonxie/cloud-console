// EventBridge items shared by AWS EventBridge (+ Scheduler) and Tencent CEB.

export type EventBridgeKind = "Rule" | "Schedule" | "Event bus";

export interface EventBridgeItem {
  kind: EventBridgeKind;
  name: string;
  /** Event bus (rules) or schedule group (schedules). */
  container: string;
  region: string;
  state?: string;
  summary?: string;
  /** Provider-side identifier needed by detail calls where the name isn't enough. */
  ref?: string;
}

export function eventBridgeItemId(item: EventBridgeItem): string {
  return [item.kind, item.region, item.container, item.name].join("|");
}
