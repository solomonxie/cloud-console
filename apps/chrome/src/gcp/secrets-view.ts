// Secrets: names and versions are listed; a value is fetched only when the
// user clicks Reveal, shown masked-by-default, and never written to storage.

import {
  accessSecretVersion,
  listSecrets,
  listSecretVersions,
  type SecretSummary,
  type SecretVersionSummary,
} from "@cloud-console/core/gcp/secrets";
import { consoleLinks } from "./console-links.ts";
import type { ViewContext } from "./context.ts";
import { clear, copyText, emptyState, externalLink, formatTime, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";

export async function renderSecrets(container: HTMLElement, ctx: ViewContext): Promise<void> {
  clear(container);
  container.append(statusLine("loading", "Loading secrets…"));
  let secrets: SecretSummary[];
  try {
    secrets = await listSecrets(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    clear(container);
    container.append(statusLine("error", describeError(err, "Couldn't list secrets")));
    return;
  }
  if (!ctx.isCurrent()) return;
  clear(container);
  if (!secrets.length) {
    container.append(emptyState("key", "No secrets", "This project has no Secret Manager secrets this credential can see."));
    return;
  }
  const list = h("div", { class: "gcp-list" });
  for (const s of secrets) list.append(secretRow(s, ctx));
  container.append(list, h("div", { class: "list-stats" }, `${secrets.length} secret${secrets.length === 1 ? "" : "s"}`));
}

function secretRow(secret: SecretSummary, ctx: ViewContext): HTMLElement {
  const wrap = h("div", { class: "gcp-group" });
  const chevron = h("span", { class: "gcp-chevron" });
  chevron.append(icon("chevronRight"));
  const badge = h("span", { class: "badge" });
  badge.append(icon("key"));
  const labels = secret.labels ? Object.entries(secret.labels).map(([k, v]) => `${k}=${v}`).join(", ") : "";
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0, "aria-expanded": "false" },
    chevron,
    badge,
    h(
      "div",
      { class: "name gcp-two-line" },
      h("span", { class: "gcp-title" }, secret.secretId),
      h("small", {}, [`created ${formatTime(secret.createTime)}`, labels].filter(Boolean).join(" · "))
    ),
    h("div", { class: "actions" }, externalLink(consoleLinks.secret(ctx.projectId, secret.secretId)))
  );
  const versions = h("div", { class: "gcp-members", hidden: true });
  let loaded = false;
  const toggle = () => {
    const open = versions.hidden !== false;
    versions.hidden = !open;
    row.setAttribute("aria-expanded", String(open));
    wrap.classList.toggle("open", open);
    if (open && !loaded) {
      loaded = true;
      void loadVersions(versions, secret, ctx);
    }
    if (!open) {
      // Collapsing drops any revealed values from the DOM.
      versions.querySelectorAll<HTMLElement>(".gcp-secret-value").forEach((el) => el.dispatchEvent(new Event("gcp-hide")));
    }
  };
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") toggle();
  });
  wrap.append(row, versions);
  return wrap;
}

async function loadVersions(container: HTMLElement, secret: SecretSummary, ctx: ViewContext): Promise<void> {
  container.replaceChildren(statusLine("loading", "Loading versions…"));
  let versions: SecretVersionSummary[];
  try {
    versions = await listSecretVersions(ctx.creds, ctx.projectId, secret.secretId);
  } catch (err) {
    container.replaceChildren(statusLine("error", describeError(err, "Couldn't list versions")));
    return;
  }
  clear(container);
  if (!versions.length) {
    container.append(h("div", { class: "gcp-member muted" }, "No versions."));
    return;
  }
  for (const v of versions) container.append(versionRow(v, secret, ctx));
}

const MASK = "••••••••••••";

function versionRow(version: SecretVersionSummary, secret: SecretSummary, ctx: ViewContext): HTMLElement {
  const enabled = version.state === "ENABLED";
  const value = h("code", { class: "gcp-secret-value masked" }, enabled ? MASK : "");
  const error = h("div", { class: "gcp-secret-error", hidden: true });
  // The revealed value lives only in this closure and the DOM node while
  // shown — never in chrome.storage or any cache.
  let shown = false;
  let revealed: string | null = null;

  const setShown = (text: string, copyable: string | null) => {
    shown = true;
    revealed = copyable;
    value.textContent = text;
    value.classList.remove("masked");
    revealBtn.replaceChildren(icon("eyeOff"));
    revealBtn.title = "Hide";
    copyBtn.disabled = copyable === null;
  };

  const hide = () => {
    shown = false;
    revealed = null;
    value.textContent = MASK;
    value.classList.add("masked");
    revealBtn.replaceChildren(icon("eye"));
    revealBtn.title = "Reveal";
    copyBtn.disabled = true;
  };
  value.addEventListener("gcp-hide", hide);

  const revealBtn = iconButton("eye", "Reveal", () => {
    if (shown) hide();
    else void reveal();
  });
  const copyBtn = iconButton("copy", "Copy value", () => {
    if (revealed !== null) void copyText(revealed, copyBtn);
  });
  copyBtn.disabled = true;

  async function reveal(): Promise<void> {
    revealBtn.disabled = true;
    error.hidden = true;
    try {
      const payload = await accessSecretVersion(ctx.creds, ctx.projectId, secret.secretId, version.version);
      if (payload.isBinary) setShown(`(binary, ${payload.bytes.length} bytes — not shown)`, null);
      else setShown(payload.text ?? "", payload.text ?? "");
    } catch (err) {
      error.textContent = describeError(err, "Couldn't access this version");
      error.hidden = false;
    } finally {
      revealBtn.disabled = false;
    }
  }

  return h(
    "div",
    { class: "gcp-version" },
    h(
      "div",
      { class: "gcp-version-head" },
      h("span", { class: "gcp-title" }, `v${version.version}`),
      h("span", { class: `gcp-pill ${enabled ? "ok" : version.state === "DESTROYED" ? "off" : "muted"}` }, version.state.toLowerCase()),
      h("small", { class: "meta" }, formatTime(version.createTime)),
      h("span", { class: "spacer" }),
      enabled ? revealBtn : null,
      enabled ? copyBtn : null
    ),
    enabled ? value : null,
    error
  );
}
