// AWS Billing via Cost Explorer (global, ce.us-east-1), on the shared
// vendor-neutral Billing screen — same loaders and cache keys as the mobile
// app's (month-to-date, 11 months of history, per-service drill-down).
import { monthlyBills, monthToDateCost, serviceDetail } from "@cloud-console/core/aws/cost-explorer";
import { COST_DETAIL_TTL } from "@cloud-console/core/cache";
import { kindBillingScreen } from "../app/billing-screen.ts";
import { registerKindScreen } from "../app/kind-screens.ts";
import { awsKey, cached, cacheKey } from "./common.ts";

registerKindScreen("aws", "billing", (conn) =>
  kindBillingScreen({
    subtitle: conn.name ?? "",
    monthToDate: (fresh) => cached(cacheKey("billing-mtd", conn), () => monthToDateCost(awsKey(conn)), { force: fresh }),
    // The month in the key drops stale pre-rollover data.
    history: (fresh) =>
      cached(`${cacheKey("billing-history", conn)}:${new Date().toISOString().slice(0, 7)}`, () => monthlyBills(awsKey(conn), 11), { force: fresh }),
    // Cost Explorer charges per request; drill-downs keep an hour.
    serviceDetail: (service, bill, fresh) =>
      cached(
        `${cacheKey(`billing-detail@${service.serviceName}`, conn)}:${bill.periodStart}`,
        () => serviceDetail(awsKey(conn), service.serviceName, bill.periodStart, bill.periodEnd),
        { ttl: COST_DETAIL_TTL, force: fresh }
      ),
  })
);
