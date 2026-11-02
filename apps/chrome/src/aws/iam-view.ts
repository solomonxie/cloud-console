// IAM users and roles (global): searchable lists and a principal page like
// the mobile app's principal.tsx — details, attached and inline policies,
// each policy fetching its JSON document only when expanded.
import {
  attachedPolicyDocument,
  inlineRolePolicyDocument,
  inlineUserPolicyDocument,
  listAttachedRolePolicies,
  listAttachedUserPolicies,
  listRolePolicyNames,
  listRoles,
  listUserPolicyNames,
  listUsers,
  type IAMRole,
  type IAMUser,
} from "@cloud-console/core/aws/iam";
import { prettyJsonString } from "@cloud-console/core/detail";
import { formatDate } from "@cloud-console/core/format";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav, type Screen } from "../app/nav.ts";
import { h, statusLine } from "../gcp/dom.ts";
import { listScreen } from "../app/list-screen.ts";
import { awsKey, cached, cacheKey, describe } from "./common.ts";
import { codeBlock, detailList, lazyDisclosure, screenSubtitle, section } from "./ui.ts";

registerKindScreen("aws", "iamUsers", (conn) =>
  listScreen<IAMUser>({
    title: "IAM Users",
    subtitle: conn.name || undefined,
    noun: ["user", "users"],
    emptyIcon: "user",
    filterPlaceholder: "Filter by name or ARN",
    favoritesScope: `aws:${conn.id}:iamUsers`,
    load: (fresh) => cached(cacheKey("iam-users", conn), () => listUsers(awsKey(conn)), { force: fresh }),
    row: (x) => ({
      id: x.arn,
      icon: "user",
      title: x.userName,
      subtitle: x.arn,
      open: () => nav.push(principalScreen(conn, "user", x.userName, x)),
    }),
  })
);

registerKindScreen("aws", "iamRoles", (conn) =>
  listScreen<IAMRole>({
    title: "IAM Roles",
    subtitle: conn.name || undefined,
    noun: ["role", "roles"],
    emptyIcon: "users",
    filterPlaceholder: "Filter by name or ARN",
    favoritesScope: `aws:${conn.id}:iamRoles`,
    load: (fresh) => cached(cacheKey("iam-roles", conn), () => listRoles(awsKey(conn)), { force: fresh }),
    row: (x) => ({
      id: x.arn,
      icon: "users",
      title: x.roleName,
      subtitle: x.arn,
      open: () => nav.push(principalScreen(conn, "role", x.roleName, x)),
    }),
  })
);

interface PolicyRef {
  title: string;
  subtitle?: string;
  load: () => Promise<string>;
}

function principalScreen(conn: StorageConnection, kind: "user" | "role", name: string, item: IAMUser | IAMRole): Screen {
  let alive = true;
  const attachedEl = h("div", { class: "aws-policies" }, statusLine("loading", "Loading policies…"));
  const inlineEl = h("div", { class: "aws-policies" });
  const inlineSection = section("Inline policies", inlineEl);
  inlineSection.hidden = true;

  const policyRow = (p: PolicyRef) =>
    lazyDisclosure(
      h("span", { class: "gcp-two-line" }, h("span", { class: "gcp-title" }, p.title), p.subtitle ? h("small", {}, p.subtitle) : null),
      async (into) => {
        into.replaceChildren(statusLine("loading", "Loading document…"));
        try {
          const doc = await p.load();
          into.replaceChildren(codeBlock(prettyJsonString(doc)));
        } catch (err) {
          into.replaceChildren(statusLine("error", describe(err, "Couldn't load the policy")));
        }
      }
    );

  const load = async () => {
    const key = awsKey(conn);
    try {
      const [attached, inline] =
        kind === "user"
          ? await Promise.all([listAttachedUserPolicies(key, name), listUserPolicyNames(key, name)])
          : await Promise.all([listAttachedRolePolicies(key, name), listRolePolicyNames(key, name)]);
      if (!alive) return;
      const attachedRefs: PolicyRef[] = attached.map((p) => ({ title: p.policyName, subtitle: p.policyArn, load: () => attachedPolicyDocument(key, p.policyArn) }));
      const inlineRefs: PolicyRef[] = inline.map((n) => ({
        title: n,
        load: () => (kind === "user" ? inlineUserPolicyDocument(key, name, n) : inlineRolePolicyDocument(key, name, n)),
      }));
      attachedEl.replaceChildren(...(attachedRefs.length ? attachedRefs.map(policyRow) : [h("div", { class: "gcp-muted" }, "No attached policies")]));
      inlineEl.replaceChildren(...(inlineRefs.length ? inlineRefs.map(policyRow) : [h("div", { class: "gcp-muted" }, "No inline policies")]));
      inlineSection.hidden = false;
    } catch (err) {
      if (alive) attachedEl.replaceChildren(statusLine("error", describe(err, "Couldn't load policies")));
    }
  };

  return {
    title: name,
    subtitle: screenSubtitle(conn),
    render(body) {
      body.classList.add("gcp-detail");
      body.append(
        section(
          "Details",
          detailList([
            [kind === "user" ? "User name" : "Role name", name],
            ["ARN", item.arn],
            ["Path", item.path],
            ["Created", item.createDate ? formatDate(item.createDate) : undefined],
          ])
        ),
        section("Attached policies", attachedEl),
        inlineSection
      );
      void load();
    },
    onLeave() {
      alive = false;
    },
  };
}
