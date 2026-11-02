// SSM Parameter Store in every enabled region, grouped by region, and a
// parameter page like the mobile app's parameter.tsx: a String/StringList
// value loads on open; a SecureString is decrypted only when Reveal is
// clicked. Values live only in the DOM while shown — never cached or stored.
import { isSecure, listParameters, parameterDetailFields, parameterValue, type SSMParameter } from "@cloud-console/core/aws/parameter-store";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav, type Screen } from "../app/nav.ts";
import { copyText, h, icon, iconButton, statusLine } from "../gcp/dom.ts";
import { awsKey, describe } from "./common.ts";
import { detailList, regionalListScreen, screenSubtitle, section } from "./ui.ts";

registerKindScreen("aws", "parameterStore", (conn) =>
  regionalListScreen<SSMParameter>({
    conn,
    kind: "parameterStore",
    cacheKind: "ssm-parameters",
    title: "Parameter Store",
    noun: ["parameter", "parameters"],
    filter: "Filter by name, type, description…",
    emptyIcon: "sliders",
    fetch: (region) => listParameters(awsKey(conn), region),
    row: (p) => ({
      icon: isSecure(p) ? "lock" : "sliders",
      title: p.name,
      subtitle: [p.type, p.version !== undefined ? `v${p.version}` : undefined, p.description || undefined].filter(Boolean).join(" · "),
      search: [p.name, p.type, p.description, p.region].join(" "),
      favId: `${p.region}|${p.name}`,
      onOpen: () => nav.push(parameterScreen(conn, p)),
    }),
  })
);

function parameterScreen(conn: StorageConnection, p: SSMParameter): Screen {
  let alive = true;
  const valueEl = h("div", {});

  const show = (value: string) => {
    const code = h("code", { class: "gcp-secret-value" }, value || " ");
    const copyBtn = iconButton("copy", "Copy value", () => void copyText(value, copyBtn));
    const children: Node[] = [h("div", { class: "aws-value-row" }, code, copyBtn)];
    if (isSecure(p)) {
      // Hiding drops the value from the DOM; revealing again re-fetches.
      children.push(h("button", { type: "button", class: "link-btn", onclick: () => idle() }, icon("eyeOff"), "Hide"));
    }
    valueEl.replaceChildren(...children);
  };

  const idle = () => {
    const reveal = h("button", { type: "button", class: "btn" }, icon("eye"), "Reveal");
    reveal.addEventListener("click", () => void fetch());
    valueEl.replaceChildren(reveal);
  };

  const fetch = async () => {
    valueEl.replaceChildren(statusLine("loading", isSecure(p) ? "Decrypting…" : "Loading value…"));
    try {
      const value = await parameterValue(awsKey(conn), p, isSecure(p));
      if (alive) show(value);
    } catch (err) {
      if (!alive) return;
      const retry = h("button", { type: "button", class: "btn" }, icon("refresh"), "Retry");
      retry.addEventListener("click", () => void fetch());
      valueEl.replaceChildren(statusLine("error", describe(err, "Couldn't load the value")), retry);
    }
  };

  return {
    title: p.name,
    subtitle: screenSubtitle(conn, p.region),
    render(body) {
      body.classList.add("gcp-detail");
      body.append(section("Value", valueEl), section("Details", detailList(parameterDetailFields(p))));
      if (isSecure(p)) idle();
      else void fetch();
    },
    onLeave() {
      alive = false;
      valueEl.replaceChildren();
    },
  };
}
