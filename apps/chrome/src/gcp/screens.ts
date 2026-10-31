// Google Cloud screens for the stack navigator: Home lists GCP accounts like
// any other connection; tapping one of its resource kinds pushes
// gcpResourceScreen (project picker + filtered list), whose rows push detail
// screens. Everything runs with the credential's own IAM permissions,
// straight against Google's APIs.

import type { GoogleCredentials } from "@cloud-console/core/gcp/auth";
import { listProjects, type GcpProject } from "@cloud-console/core/gcp/projects";
import type { Screen } from "../app/nav.ts";
import { decorateFavorites } from "../lib/favorites.ts";
import { applyFilter, combobox, filterBox, type ComboOption } from "../ui/search.ts";
import {
  credentialsLabel,
  deleteAccount,
  newAccountId,
  parseCredentials,
  rememberProject,
  upsertAccount,
  type GcpAccount,
} from "./accounts.ts";
import { renderBuckets } from "./buckets-view.ts";
import { ADC_PATH, credentialsFor, deleteHandle, pickCredentialsFile, readHandle, saveHandle } from "./credentials-file.ts";
import { cachedProjects, forgetAccount } from "./cache.ts";
import { consoleLinks } from "./console-links.ts";
import { favoritesScope, type ListResult, type ViewContext } from "./context.ts";
import { confirmDialog, emptyState, externalLink, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";
import { renderGroups } from "./groups-view.ts";
import { renderInstances } from "./instances-view.ts";
import { renderSecrets } from "./secrets-view.ts";

export type GcpKind = "gcs" | "gceInstances" | "gceInstanceGroups" | "gcpSecrets";

interface KindInfo {
  title: string;
  filter: string;
  consoleLink: (project: string) => string;
  render: (container: HTMLElement, ctx: ViewContext, account: GcpAccount) => Promise<ListResult | null>;
}

const KINDS: Record<GcpKind, KindInfo> = {
  gcs: {
    title: "Cloud Storage",
    filter: "Filter by name or location",
    consoleLink: consoleLinks.buckets,
    render: (c, ctx, account) => renderBuckets(c, ctx, account.credentialsJson),
  },
  gceInstances: {
    title: "VM Instances",
    filter: "Filter by name, zone, IP, label…",
    consoleLink: consoleLinks.instances,
    render: (c, ctx) => renderInstances(c, ctx),
  },
  gceInstanceGroups: {
    title: "Instance Groups",
    filter: "Filter by name or location",
    consoleLink: consoleLinks.instanceGroups,
    render: (c, ctx) => renderGroups(c, ctx),
  },
  gcpSecrets: {
    title: "Secrets",
    filter: "Filter by name or label",
    consoleLink: consoleLinks.secrets,
    render: (c, ctx) => renderSecrets(c, ctx),
  },
};

function projectLabel(p: GcpProject): string {
  return p.name && p.name !== p.projectId ? `${p.name} (${p.projectId})` : p.projectId;
}

// The credential's own project: a service account may lack
// resourcemanager.projects.list but still work inside it.
function ownProject(creds: GoogleCredentials): string | undefined {
  return creds.type !== "authorized_user" ? creds.project_id : creds.quota_project_id;
}

export function gcpResourceScreen(account: GcpAccount, kind: GcpKind): Screen {
  const info = KINDS[kind];
  let body: HTMLElement;
  let creds: GoogleCredentials;
  let hasCreds = false; // set once the credentials parse
  let projectId: string | undefined;
  let generation = 0; // bumped on every project switch / reload / leave
  let changed = false; // a detail screen changed something; reload on return
  let query = "";
  let current: ListResult | null = null;

  const consoleSlot = h("span", { class: "gcp-console-slot" });
  const projectBox = combobox({
    placeholder: "Search projects or type a project ID",
    options: [],
    allowFreeText: true,
    onPick: (v) => selectProject(v),
  });
  projectBox.setDisabled(true);
  const listEl = h("div", { class: "gcp-list-body" });
  const projectNote = h("div", {});

  function updateStats(): void {
    if (!current) return;
    const total = current.rows.length;
    const shown = applyFilter(current.rows, query);
    const [one, many] = current.noun;
    const n = `${total} ${total === 1 ? one : many}`;
    current.stats.textContent = query ? `${shown} of ${n}` : n;
  }

  const filter = filterBox(info.filter, (q) => {
    query = q;
    updateStats();
  });
  filter.hidden = true;

  return {
    title: info.title,
    subtitle: account.name,
    render(el, header) {
      body = el;
      body.classList.add("gcp-screen");
      // A linked file is re-read on refresh too, so a fresh gcloud login is
      // picked up without leaving the screen.
      header.actions.append(
        iconButton("refresh", "Refresh", () => void (account.credentialsFile || !hasCreds ? loadCredentials() : reload(true))),
        consoleSlot
      );
      body.append(h("div", { class: "gcp-project-bar" }, projectBox.el), projectNote, filter, listEl);
      void loadCredentials();
    },
    onLeave() {
      generation++;
    },
    onShow() {
      if (!changed) return;
      changed = false;
      void reload(true);
    },
  };

  // A linked file is read fresh each time the screen opens; the result
  // lives only in memory (on this account object, for the views below).
  async function loadCredentials(): Promise<void> {
    try {
      account.credentialsJson = await credentialsFor(account, listEl);
      creds = parseCredentials(account.credentialsJson);
      hasCreds = true;
    } catch (err) {
      listEl.replaceChildren(statusLine("error", (err as Error).message));
      return;
    }
    void loadProjects(false);
  }

  async function loadProjects(fresh: boolean): Promise<void> {
    const gen = ++generation;
    if (fresh) forgetAccount(account.id);
    listEl.replaceChildren(statusLine("loading", "Loading projects…"));
    let projects: GcpProject[] = [];
    let listError: unknown;
    try {
      projects = [...(await cachedProjects(account.id, creds))];
    } catch (err) {
      listError = err;
    }
    if (gen !== generation) return;
    const own = ownProject(creds);
    if (own && !projects.some((p) => p.projectId === own)) projects.unshift({ projectId: own, projectNumber: "", name: own });
    const options: ComboOption[] = projects.map((p) => ({ value: p.projectId, label: projectLabel(p), detail: p.name !== p.projectId ? p.projectId : undefined }));
    // A remembered project may have been typed in (usable but not listable).
    const wanted = account.lastProjectId ?? projects[0]?.projectId;
    projectBox.setOptions(options, wanted ?? "");
    projectBox.setDisabled(false);
    projectNote.replaceChildren(
      listError
        ? statusLine("info", `${describeError(listError, "Couldn't list projects")} You can still type a project ID above.`)
        : ""
    );
    if (!wanted) {
      listEl.replaceChildren(
        emptyState("cloud", "No projects visible", "This credential can't list any project. Type a project ID above, or see docs/gcp-access.md for the roles it needs.")
      );
      return;
    }
    selectProject(wanted);
  }

  function selectProject(id: string): void {
    projectId = id;
    consoleSlot.replaceChildren(externalLink(info.consoleLink(id), `Open ${info.title} in Google Cloud console`));
    if (account.lastProjectId !== id) {
      account.lastProjectId = id;
      void rememberProject(account.id, id);
    }
    void reload(false);
  }

  async function reload(fresh: boolean): Promise<void> {
    if (!projectId) {
      if (fresh) await loadProjects(true);
      return;
    }
    const gen = ++generation;
    current = null;
    filter.hidden = true;
    const ctx: ViewContext = {
      accountId: account.id,
      creds,
      projectId,
      fresh,
      isCurrent: () => gen === generation,
      markChanged: () => {
        changed = true;
      },
    };
    const result = await info.render(listEl, ctx, account);
    if (gen !== generation) return;
    current = result;
    filter.hidden = !result;
    updateStats();
    // Rows carry data-fav-id: star each and pin favorites on top.
    if (result) void decorateFavorites(favoritesScope(ctx, kind), result.rows);
  }
}

// --- Add / edit account dialog ----------------------------------------------

export function openGcpAccountDialog(existing: GcpAccount | undefined, onSaved: () => void): void {
  const dialog = h("dialog", { class: "gcp-dialog gcp-account-dialog" });
  const status = h("div", {});
  const nameInput = h("input", { autocomplete: "off", placeholder: "e.g. Work — prod", value: existing?.name ?? "" });

  // Two ways to supply credentials: link a file that's re-read on every
  // use (the default — a gcloud re-login just works), or paste a copy.
  let source: "file" | "paste" = existing && !existing.credentialsFile ? "paste" : "file";
  let picked: FileSystemFileHandle | null = null; // a newly linked file, saved with the account
  let pickedJson = "";

  const jsonInput = h("textarea", {
    rows: 7,
    spellcheck: "false",
    placeholder: '{ "type": "service_account", … }  or  gcloud ADC JSON',
  });
  if (existing && !existing.credentialsFile) jsonInput.value = existing.credentialsJson;

  const fileName = h("code", { class: "gcp-file-name" }, existing?.credentialsFile ?? "No file linked");
  const pickBtn = h("button", { type: "button", class: "btn" }, icon("key"), existing?.credentialsFile ? "Change file…" : "Link file…");
  pickBtn.addEventListener("click", async () => {
    // The picker can't be opened at a path; put the usual one on the
    // clipboard so ⌘⇧G + paste gets there in one step.
    await navigator.clipboard.writeText(ADC_PATH).catch(() => undefined);
    try {
      const handle = await pickCredentialsFile();
      if (!handle) return;
      const json = await readHandle(handle);
      const creds = parseCredentials(json);
      picked = handle;
      pickedJson = json;
      fileName.textContent = handle.name;
      pickBtn.lastChild!.textContent = "Change file…";
      status.replaceChildren();
      if (!nameInput.value) nameInput.value = credentialsLabel(creds);
    } catch (err) {
      status.replaceChildren(statusLine("error", (err as Error).message));
    }
  });
  const fileField = h(
    "div",
    { class: "field" },
    h("span", {}, "Credentials file"),
    h("div", { class: "gcp-file-row" }, fileName, pickBtn),
    h(
      "p",
      { class: "hint" },
      `Usually ${ADC_PATH} (from \`gcloud auth application-default login\`). In the picker press ⌘⇧G and paste — the path is already on your clipboard. Read fresh each time it's used; Chrome asks first, and its "Allow on every visit" stops the asking. Never copied or stored.`
    )
  );
  const pasteField = h(
    "div",
    {},
    h("label", { class: "field" }, h("span", {}, "Credentials JSON"), jsonInput),
    h("p", { class: "hint" }, "A service account key or gcloud ADC JSON. Stored only on this device.")
  );

  const sourceTabs = h("div", { class: "gcp-source-tabs", role: "tablist" });
  const setSource = (next: "file" | "paste") => {
    source = next;
    fileField.hidden = next !== "file";
    pasteField.hidden = next !== "paste";
    for (const b of sourceTabs.querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("active", b.dataset.source === next);
      b.setAttribute("aria-selected", String(b.dataset.source === next));
    }
  };
  for (const [id, label] of [["file", "Link a file"], ["paste", "Paste JSON"]] as const) {
    const b = h("button", { type: "button", role: "tab", "data-source": id }, label);
    b.addEventListener("click", () => setSource(id));
    sourceTabs.append(b);
  }
  setSource(source);

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
    sourceTabs,
    fileField,
    pasteField,
    h(
      "div",
      { class: "modal-actions" },
      existing ? h("button", { type: "button", class: "btn danger", onclick: () => void remove() }, "Delete") : null,
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn", onclick: close }, "Cancel"),
      saveBtn
    )
  );

  // The JSON to validate on save: the pasted text, a newly picked file, or
  // (editing a linked account without re-picking) the linked file read now.
  async function currentJson(): Promise<string> {
    if (source === "paste") return jsonInput.value.trim();
    if (picked) return pickedJson;
    if (existing?.credentialsFile) return credentialsFor(existing, status);
    throw new Error("Link a credentials file first.");
  }

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
    await deleteHandle(existing.id);
    forgetAccount(existing.id);
    close();
    onSaved();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let json: string;
    let creds: GoogleCredentials;
    try {
      json = await currentJson();
      creds = parseCredentials(json);
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
    const linked = source === "file";
    const account: GcpAccount = {
      id: existing?.id ?? newAccountId(),
      type: "gcp",
      name: nameInput.value.trim() || credentialsLabel(creds),
      // A linked account keeps no copy — the file is read on each use.
      credentialsJson: linked ? "" : json,
      credentialsFile: linked ? (picked?.name ?? existing?.credentialsFile) : undefined,
      lastProjectId: existing?.lastProjectId,
    };
    if (linked && picked) await saveHandle(account.id, picked);
    if (!linked) await deleteHandle(account.id);
    await upsertAccount(account);
    forgetAccount(account.id);
    close();
    onSaved();
  });

  dialog.append(form);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}
