// A user or role (port of the mobile app's principal.tsx): its details,
// then its attached (and, where the vendor has them, inline) policies; each
// policy fetches its JSON document only when expanded.
import { prettyJsonString } from "@cloud-console/core/detail";
import { h, icon, statusLine } from "../gcp/dom.ts";
import { errorMessage } from "../sidepanel/dom.ts";
import { codeBlock, detailSection, fieldList } from "./detail-screen.ts";
import type { Screen } from "./nav.ts";

export interface PolicyRef {
  title: string;
  subtitle?: string;
  load: () => Promise<string>;
}

export interface PrincipalOpts {
  title: string;
  subtitle?: string;
  fields: { label: string; value: string }[];
  // `inline` undefined: the vendor has no inline policies (CAM).
  policies: () => Promise<{ attached: PolicyRef[]; inline?: PolicyRef[] }>;
}

function policyRow(policy: PolicyRef): HTMLElement {
  const summary = h(
    "summary",
    { class: "bill-row" },
    h("span", { class: "gcp-chevron" }, icon("chevronRight")),
    h("span", { class: "name gcp-two-line bill-name" }, h("span", { class: "gcp-title" }, policy.title), policy.subtitle ? h("small", {}, policy.subtitle) : null)
  );
  const body = h("div", { class: "bill-group-body policy-doc" });
  const details = h("details", { class: "bill-group" }, summary, body);
  let loaded = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    body.replaceChildren(statusLine("loading", "Loading policy…"));
    try {
      body.replaceChildren(codeBlock(prettyJsonString(await policy.load())));
    } catch (err) {
      loaded = false;
      body.replaceChildren(statusLine("error", errorMessage(err)));
    }
  });
  return details;
}

function policyList(list: PolicyRef[], empty: string): HTMLElement {
  return list.length ? h("div", { class: "bill-list" }, ...list.map(policyRow)) : h("div", { class: "gcp-muted bill-muted" }, empty);
}

export function principalScreen(opts: PrincipalOpts): Screen {
  let generation = 0;
  return {
    title: opts.title,
    subtitle: opts.subtitle,
    render(body) {
      body.classList.add("gcp-detail");
      const gen = ++generation;
      const attached = h("div", {}, statusLine("loading", "Loading policies…"));
      const inline = h("div", {});
      body.append(detailSection("Details", fieldList(opts.fields)), detailSection("Attached policies", attached), inline);
      opts.policies().then(
        (p) => {
          if (gen !== generation) return;
          attached.replaceChildren(policyList(p.attached, "No attached policies"));
          if (p.inline) inline.replaceChildren(detailSection("Inline policies", policyList(p.inline, "No inline policies")));
        },
        (err) => {
          if (gen !== generation) return;
          attached.replaceChildren(statusLine("error", errorMessage(err)));
        }
      );
    },
    onLeave() {
      generation++;
    },
  };
}
