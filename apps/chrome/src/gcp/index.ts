// "Google Cloud" sidepanel section: pick a GCP account (credentials JSON
// stored in chrome.storage.local `gcpAccounts`), pick a project, then browse
// VM instances, instance groups and secrets. Everything runs with the
// credential's own IAM permissions, straight against Google's APIs.

import type { GoogleCredentials } from "@cloud-console/core/gcp/auth";
import { listProjects, type GcpProject } from "@cloud-console/core/gcp/projects";
import { registerSection } from "../shell/registry.ts";
import {
  credentialsLabel,
  deleteAccount,
  getAccounts,
  getLastAccountId,
  newAccountId,
  parseCredentials,
  rememberProject,
  setLastAccountId,
  upsertAccount,
  type GcpAccount,
} from "./accounts.ts";
import { consoleLinks } from "./console-links.ts";
import type { ViewContext } from "./context.ts";
import { clear, confirmDialog, emptyState, externalLink, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";
import { renderGroups } from "./groups-view.ts";
import { renderInstances } from "./instances-view.ts";
import { renderSecrets } from "./secrets-view.ts";

type Tab = "instances" | "groups" | "secrets";

const TABS: { id: Tab; label: string; icon: string; render: (c: HTMLElement, ctx: ViewContext) => Promise<void> }[] = [
  { id: "instances", label: "VM instances", icon: "server", render: renderInstances },
  { id: "groups", label: "Instance groups", icon: "layers", render: renderGroups },
  { id: "secrets", label: "Secrets", icon: "key", render: renderSecrets },
];

const LAST_TAB_KEY = "gcpLastTab";

interface State {
  accounts: GcpAccount[];
  account?: GcpAccount;
  creds?: GoogleCredentials;
  projects: GcpProject[];
  projectId?: string;
  tab: Tab;
  generation: number; // bumped on every account/project/tab switch
}

async function renderSection(container: HTMLElement): Promise<void> {
  const root = h("div", { class: "gcp-section" });
  clear(container);
  container.append(root);

  const state: State = { accounts: [], projects: [], tab: "instances", generation: 0 };
  try {
    const t = (await chrome.storage.local.get(LAST_TAB_KEY))[LAST_TAB_KEY];
    if (TABS.some((x) => x.id === t)) state.tab = t as Tab;
  } catch {
    // keep default
  }

  const accountSelect = h("select", { "aria-label": "Google Cloud account" });
  const projectSelect = h("select", { "aria-label": "Project", disabled: true });
  const projectLink = h("span", { class: "gcp-project-link" });
  const tabBar = h("div", { class: "gcp-tabs", role: "tablist" });
  const body = h("div", { class: "gcp-body" });

  root.append(
    h(
      "div",
      { class: "topbar gcp-topbar" },
      h("span", { class: "brand", title: "Google Cloud" }, icon("cloud")),
      accountSelect,
      iconButton("plus", "Add Google Cloud account", () => openAccountDialog()),
      iconButton("settings", "Edit account", () => state.account && openAccountDialog(state.account))
    ),
    h(
      "div",
      { class: "toolbar gcp-project-bar" },
      projectSelect,
      projectLink,
      iconButton("refresh", "Refresh", () => renderTab())
    ),
    tabBar,
    body
  );

  for (const t of TABS) {
    const btn = h("button", { type: "button", class: "gcp-tab", role: "tab", "data-tab": t.id });
    btn.append(icon(t.icon), h("span", {}, t.label));
    btn.addEventListener("click", () => {
      state.tab = t.id;
      void chrome.storage.local.set({ [LAST_TAB_KEY]: t.id });
      renderTab();
    });
    tabBar.append(btn);
  }

  accountSelect.addEventListener("change", () => {
    const acct = state.accounts.find((a) => a.id === accountSelect.value);
    if (acct) void selectAccount(acct);
  });
  projectSelect.addEventListener("change", () => {
    void selectProject(projectSelect.value);
  });

  function setChromeVisible(visible: boolean): void {
    projectSelect.parentElement!.hidden = !visible;
    tabBar.hidden = !visible;
  }

  async function loadAccounts(selectId?: string): Promise<void> {
    state.accounts = await getAccounts();
    clear(accountSelect);
    for (const a of state.accounts) accountSelect.append(h("option", { value: a.id }, a.name));
    if (!state.accounts.length) {
      state.account = undefined;
      state.creds = undefined;
      accountSelect.disabled = true;
      accountSelect.append(h("option", {}, "No Google Cloud accounts"));
      setChromeVisible(false);
      clear(body);
      const add = h("button", { type: "button", class: "btn primary" }, icon("plus"), "Add account");
      add.addEventListener("click", () => openAccountDialog());
      body.append(
        emptyState(
          "cloud",
          "Connect a Google Cloud account",
          "Use a service account JSON key, or gcloud's application default credentials file."
        ),
        h("div", { class: "gcp-center" }, add)
      );
      return;
    }
    accountSelect.disabled = false;
    const wanted = selectId ?? (await getLastAccountId());
    const acct = state.accounts.find((a) => a.id === wanted) ?? state.accounts[0]!;
    accountSelect.value = acct.id;
    await selectAccount(acct);
  }

  async function selectAccount(acct: GcpAccount): Promise<void> {
    const gen = ++state.generation;
    state.account = acct;
    void setLastAccountId(acct.id);
    try {
      state.creds = parseCredentials(acct.credentialsJson);
    } catch (err) {
      setChromeVisible(false);
      body.replaceChildren(statusLine("error", (err as Error).message));
      return;
    }
    setChromeVisible(true);
    projectSelect.disabled = true;
    projectSelect.replaceChildren(h("option", {}, "Loading projects…"));
    body.replaceChildren(statusLine("loading", "Loading projects…"));
    try {
      state.projects = await listProjects(state.creds);
    } catch (err) {
      if (gen !== state.generation) return;
      projectSelect.replaceChildren(h("option", {}, "—"));
      body.replaceChildren(statusLine("error", describeError(err, "Couldn't list projects")));
      return;
    }
    if (gen !== state.generation) return;
    clear(projectSelect);
    // A service account may lack resourcemanager.projects.list but still
    // work inside its own project — offer that one.
    const own = state.creds.type !== "authorized_user" ? state.creds.project_id : state.creds.quota_project_id;
    if (own && !state.projects.some((p) => p.projectId === own)) {
      state.projects.unshift({ projectId: own, projectNumber: "", name: own });
    }
    if (!state.projects.length) {
      projectSelect.append(h("option", {}, "No projects"));
      body.replaceChildren(emptyState("cloud", "No projects visible", "This credential can't see any project. See docs/gcp-access.md for the roles it needs."));
      return;
    }
    for (const p of state.projects) {
      const label = p.name && p.name !== p.projectId ? `${p.name} (${p.projectId})` : p.projectId;
      projectSelect.append(h("option", { value: p.projectId }, label));
    }
    projectSelect.disabled = false;
    const pid = state.projects.some((p) => p.projectId === acct.lastProjectId) ? acct.lastProjectId! : state.projects[0]!.projectId;
    projectSelect.value = pid;
    await selectProject(pid);
  }

  async function selectProject(projectId: string): Promise<void> {
    state.projectId = projectId;
    projectLink.replaceChildren(externalLink(consoleLinks.project(projectId), "Open project in Google Cloud console"));
    if (state.account) {
      state.account.lastProjectId = projectId;
      void rememberProject(state.account.id, projectId);
    }
    renderTab();
  }

  function renderTab(): void {
    if (!state.creds || !state.projectId) return;
    const gen = ++state.generation;
    for (const btn of tabBar.querySelectorAll<HTMLButtonElement>(".gcp-tab")) {
      const active = btn.dataset.tab === state.tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    const tab = TABS.find((t) => t.id === state.tab)!;
    const ctx: ViewContext = { creds: state.creds, projectId: state.projectId, isCurrent: () => gen === state.generation };
    void tab.render(body, ctx);
  }

  // --- Add / edit account dialog ------------------------------------------

  function openAccountDialog(existing?: GcpAccount): void {
    const dialog = h("dialog", { class: "gcp-dialog gcp-account-dialog" });
    const status = h("div", {});
    const nameInput = h("input", { autocomplete: "off", placeholder: "e.g. Work — prod", value: existing?.name ?? "" });
    const jsonInput = h("textarea", {
      rows: 7,
      spellcheck: "false",
      placeholder: '{ "type": "service_account", … }  or  gcloud ADC JSON',
    });
    if (existing) jsonInput.value = existing.credentialsJson;
    const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      jsonInput.value = await file.text();
      fileInput.value = "";
      if (!nameInput.value) {
        try {
          nameInput.value = credentialsLabel(parseCredentials(jsonInput.value));
        } catch {
          // validated on save
        }
      }
    });
    const loadBtn = h("button", { type: "button", class: "link-btn" }, "Load from file…");
    loadBtn.addEventListener("click", () => fileInput.click());

    const saveBtn = h("button", { type: "submit", class: "btn primary" }, existing ? "Save" : "Add");
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    const form = h(
      "form",
      { method: "dialog" },
      h("h2", {}, existing ? "Edit Google Cloud account" : "Add Google Cloud account"),
      status,
      h("label", { class: "field" }, h("span", {}, "Name"), nameInput),
      h("label", { class: "field" }, h("span", {}, "Credentials JSON"), jsonInput),
      loadBtn,
      fileInput,
      h(
        "p",
        { class: "hint" },
        "A service account key, or the file from `gcloud auth application-default login` (~/.config/gcloud/application_default_credentials.json). Stored only on this device."
      ),
      h(
        "div",
        { class: "modal-actions" },
        existing
          ? h("button", { type: "button", class: "btn danger", onclick: () => void remove() }, "Delete")
          : null,
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn", onclick: close }, "Cancel"),
        saveBtn
      )
    );

    async function remove(): Promise<void> {
      if (!existing) return;
      const ok = await confirmDialog({
        title: `Delete ${existing.name}?`,
        message: "Removes this account and its stored credentials from this device.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await deleteAccount(existing.id);
      close();
      await loadAccounts();
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let creds: GoogleCredentials;
      try {
        creds = parseCredentials(jsonInput.value.trim());
      } catch (err) {
        status.replaceChildren(statusLine("error", (err as Error).message));
        return;
      }
      saveBtn.disabled = true;
      status.replaceChildren(statusLine("loading", "Checking credentials…"));
      try {
        // Validate by actually listing projects. A service account without
        // project-list permission still gets saved if it has a project_id.
        await listProjects(creds).catch((err: unknown) => {
          if (creds.type !== "authorized_user" && creds.project_id) return [];
          throw err;
        });
      } catch (err) {
        status.replaceChildren(statusLine("error", describeError(err, "Couldn't verify credentials")));
        saveBtn.disabled = false;
        return;
      }
      const account: GcpAccount = {
        id: existing?.id ?? newAccountId(),
        type: "gcp",
        name: nameInput.value.trim() || credentialsLabel(creds),
        credentialsJson: jsonInput.value.trim(),
        lastProjectId: existing?.lastProjectId,
      };
      await upsertAccount(account);
      close();
      await loadAccounts(account.id);
    });

    dialog.append(form);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  await loadAccounts();
}

registerSection({
  id: "gcp",
  title: "Google Cloud",
  icon: "cloud",
  render: renderSection,
});
