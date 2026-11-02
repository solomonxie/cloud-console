// Tencent Billing: month to date, balance, by product, a year of history,
// and each product's bill by usage and by resource.
import { COST_DETAIL_TTL } from "@cloud-console/core/cache";
import { connectionLabel } from "@cloud-console/core/storage/connection";
import * as tcBilling from "@cloud-console/core/tencent/billing";
import { kindBillingScreen } from "../app/billing-screen.ts";
import { registerKindScreen } from "../app/kind-screens.ts";
import { cached, tencentKey } from "./key.ts";

registerKindScreen("tencent", "billing", (conn) => {
  const key = tencentKey(conn);
  return kindBillingScreen({
    subtitle: connectionLabel(conn),
    monthToDate: (fresh) => cached(`billing-mtd:${conn.id}`, fresh, () => tcBilling.monthToDateCost(key)),
    // The month in the key drops stale pre-rollover data.
    history: (fresh) => cached(`billing-history:${conn.id}:${new Date().toISOString().slice(0, 7)}`, fresh, () => tcBilling.monthlyBills(key, 11)),
    serviceDetail: (service, bill, fresh) =>
      cached(`billing-detail@${service.serviceName}:${conn.id}:${bill.periodStart}`, fresh, () => tcBilling.serviceDetail(key, service, bill.periodStart.slice(0, 7)), COST_DETAIL_TTL),
  });
});
