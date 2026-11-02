// CVM instances, scanned region by region (grouped like the mobile app's
// regional lists); each opens its detail fields (cvmDetailFields).
import { connectionLabel } from "@cloud-console/core/storage/connection";
import { cvmDetailFields, listInstances, listRegions } from "@cloud-console/core/tencent/cvm";
import { detailScreen } from "../app/detail-screen.ts";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav } from "../app/nav.ts";
import { regionalScreen } from "../app/regional-screen.ts";
import { cached, favScope, tencentKey } from "./key.ts";

registerKindScreen("tencent", "cvm", (conn) => {
  const key = tencentKey(conn);
  const label = connectionLabel(conn);
  return regionalScreen({
    title: "CVM Instances",
    subtitle: label,
    noun: ["instance", "instances"],
    emptyIcon: "server",
    filterPlaceholder: "Filter by name, ID, type, state…",
    favoritesScope: favScope(conn, "cvm"),
    cacheKey: (region) => `cvm-instances@${region}:${conn.id}`,
    // Regions change rarely: cached a day.
    regions: () => cached(`cvm-regions:${conn.id}`, false, () => listRegions(key), 86_400_000),
    fetch: (region) => listInstances(key, region),
    row: (i, region) => ({
      id: `${region}/${i.instanceId}`,
      icon: "server",
      title: i.instanceName || i.instanceId,
      subtitle: `${i.instanceType} · ${i.state}`,
      search: `${i.instanceId} ${region}`,
      open: () =>
        nav.push(
          detailScreen({
            title: i.instanceName || i.instanceId,
            subtitle: `${region} · ${label}`,
            load: () => ({ fields: [...cvmDetailFields(i), { label: "Region", value: region }], documents: [] }),
          })
        ),
    }),
  });
});
