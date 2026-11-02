// CAM users and roles; each opens its details and attached policies (CAM
// has no inline policies), a policy's document loaded on expand.
import type { IAMRole, IAMUser } from "@cloud-console/core/aws/iam";
import { formatDate } from "@cloud-console/core/format";
import { connectionLabel, type StorageConnection } from "@cloud-console/core/storage/connection";
import * as cam from "@cloud-console/core/tencent/cam";
import { registerKindScreen } from "../app/kind-screens.ts";
import { listScreen } from "../app/list-screen.ts";
import { nav } from "../app/nav.ts";
import { principalScreen } from "../app/principal-screen.ts";
import { cached, favScope, tencentKey } from "./key.ts";

type Principal = { kind: "user" | "role"; name: string; arn: string; path: string; createDate?: string };

function openPrincipal(conn: StorageConnection, p: Principal): void {
  const key = tencentKey(conn);
  const fields = [
    { label: p.kind === "user" ? "User name" : "Role name", value: p.name },
    { label: "ID", value: p.arn },
    { label: "Path", value: p.path },
    ...(p.createDate ? [{ label: "Created", value: formatDate(p.createDate) }] : []),
  ];
  nav.push(
    principalScreen({
      title: p.name,
      subtitle: `CAM ${p.kind} · ${connectionLabel(conn)}`,
      fields,
      policies: async () => {
        const list = p.kind === "user" ? await cam.listAttachedUserPolicies(key, p.arn) : await cam.listAttachedRolePolicies(key, p.arn);
        return { attached: list.map((policy) => ({ title: policy.name, load: () => cam.policyDocument(key, policy) })) };
      },
    })
  );
}

registerKindScreen("tencent", "camUsers", (conn) =>
  listScreen<IAMUser>({
    title: "CAM Users",
    subtitle: connectionLabel(conn),
    noun: ["user", "users"],
    emptyIcon: "user",
    filterPlaceholder: "Filter users",
    favoritesScope: favScope(conn, "camUsers"),
    load: (fresh) => cached(`cam-users:${conn.id}`, fresh, () => cam.listUsers(tencentKey(conn))),
    row: (u) => ({
      id: u.arn,
      icon: "user",
      title: u.userName,
      subtitle: u.arn,
      open: () => openPrincipal(conn, { kind: "user", name: u.userName, arn: u.arn, path: u.path, createDate: u.createDate }),
    }),
  })
);

registerKindScreen("tencent", "camRoles", (conn) =>
  listScreen<IAMRole>({
    title: "CAM Roles",
    subtitle: connectionLabel(conn),
    noun: ["role", "roles"],
    emptyIcon: "users",
    filterPlaceholder: "Filter roles",
    favoritesScope: favScope(conn, "camRoles"),
    load: (fresh) => cached(`cam-roles:${conn.id}`, fresh, () => cam.listRoles(tencentKey(conn))),
    row: (r) => ({
      id: r.arn,
      icon: "users",
      title: r.roleName,
      subtitle: r.arn,
      open: () => openPrincipal(conn, { kind: "role", name: r.roleName, arn: r.arn, path: r.path, createDate: r.createDate }),
    }),
  })
);
