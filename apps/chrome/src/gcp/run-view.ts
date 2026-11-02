// Cloud Run: services and jobs across every region of the project, each
// opening a detail screen (a service's revisions and traffic, a job's
// executions with Run now). Env vars show names only — never values.

import {
  getService,
  listExecutions,
  listJobs,
  listRevisions,
  listServices,
  readiness,
  runJob,
  type RunContainer,
  type RunExecutionSummary,
  type RunJobSummary,
  type RunReadiness,
  type RunRevisionSummary,
  type RunService,
  type RunServiceSummary,
} from "@cloud-console/core/gcp/run";
import { GcpApiError, lastSegment } from "@cloud-console/core/gcp/request";
import type { Screen } from "../app/nav.ts";
import { nav } from "../app/nav.ts";
import { consoleLinks } from "./console-links.ts";
import type { ListResult, ProjectContext, ViewContext } from "./context.ts";
import { clear, confirmDialog, copyText, emptyState, externalLink, formatTime, h, icon, iconButton, statusLine } from "./dom.ts";
import { describeError } from "./errors.ts";

// --- Shared formatting ------------------------------------------------------

export function readyPill(ready: RunReadiness): HTMLElement {
  const tone = ready === "ready" ? "ok" : ready === "failed" ? "off" : "busy";
  return h("span", { class: `gcp-pill ${tone}` }, ready);
}

function executionPill(status: RunExecutionSummary["status"]): HTMLElement {
  const tone = status === "succeeded" ? "ok" : status === "failed" ? "off" : status === "running" ? "busy" : "muted";
  return h("span", { class: `gcp-pill ${tone}` }, status);
}

// What a permission / disabled-API error needs: the role and the API.
function runError(err: unknown, what: string, role: string): string {
  const base = describeError(err, what);
  if (err instanceof GcpApiError && (err.isPermissionDenied || err.reason === "SERVICE_DISABLED")) {
    return `${base} Needs ${role}, and the Cloud Run Admin API enabled on the project.`;
  }
  return base;
}

// "us-docker.pkg.dev/p/repo/api@sha256:abcdef…" → "api@sha256:abcdef0"
function imageTag(image: string | undefined): string {
  if (!image) return "";
  const last = image.split("/").pop() ?? image;
  const at = last.indexOf("@sha256:");
  return at >= 0 ? `${last.slice(0, at)}@${last.slice(at + 8, at + 15)}` : last;
}

function ingressText(ingress: string | undefined): string {
  if (!ingress) return "";
  if (ingress.endsWith("INTERNAL_ONLY")) return "internal";
  if (ingress.endsWith("INTERNAL_LOAD_BALANCER")) return "internal + load balancer";
  if (ingress.endsWith("_ALL")) return "all";
  return ingress.toLowerCase();
}

function labelText(labels: Record<string, string> | undefined): string {
  return labels ? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(", ") : "";
}

function formatSeconds(total: number): string {
  if (total < 60) return `${Math.round(total)}s`;
  const s = Math.round(total % 60);
  const m = Math.floor(total / 60) % 60;
  const hr = Math.floor(total / 3600);
  if (hr) return `${hr}h${m ? ` ${m}m` : ""}`;
  return `${m}m${s ? ` ${s}s` : ""}`;
}

// "300s" / "3.5s" → "5m" / "4s"
function formatDuration(d: string | undefined): string {
  if (!d) return "";
  const secs = Number.parseFloat(d);
  return Number.isNaN(secs) ? d : formatSeconds(secs);
}

function elapsed(start: string | undefined, end: string | undefined): string {
  if (!start) return "";
  const ms = (end ? Date.parse(end) : Date.now()) - Date.parse(start);
  return Number.isNaN(ms) ? "" : formatSeconds(Math.max(0, ms / 1000));
}

// "1000m" → "1", "2" → "2"
function cpuText(cpu: string | undefined): string {
  if (!cpu) return "";
  const n = cpu.endsWith("m") ? Number.parseInt(cpu, 10) / 1000 : Number.parseFloat(cpu);
  return Number.isNaN(n) ? cpu : `${n} vCPU`;
}

function section(title: string, content: HTMLElement): HTMLElement {
  return h("section", { class: "gcp-detail-section" }, h("h3", {}, title), content);
}

function metaList(): { el: HTMLDListElement; row: (k: string, v: Node | string | number | undefined) => void } {
  const el = h("dl", { class: "detail-meta" });
  const row = (k: string, v: Node | string | number | undefined) => {
    if (v === undefined || v === "") return;
    el.append(h("dt", {}, k), h("dd", {}, typeof v === "number" ? String(v) : v));
  };
  return { el, row };
}

// One card per container: image, limits, ports, env var names. Values of
// env vars are never rendered (they're often credentials).
function containerCards(containers: RunContainer[] | undefined, withCpuMode: boolean): HTMLElement {
  const wrap = h("div", { class: "gcp-cards" });
  if (!containers?.length) wrap.append(h("div", { class: "gcp-muted" }, "No containers."));
  for (const c of containers ?? []) {
    const kv = h("dl", { class: "gcp-card-kv" });
    const add = (k: string, v: string | undefined) => {
      if (v) kv.append(h("dt", {}, k), h("dd", {}, v));
    };
    const limits = c.resources?.limits;
    add("Image", c.image);
    add("CPU", cpuText(limits?.cpu));
    add("Memory", limits?.memory);
    // cpuIdle: CPU is throttled outside requests ("request-based billing").
    if (withCpuMode) add("CPU mode", c.resources?.cpuIdle === false ? "always allocated" : "only during requests");
    add("Ports", c.ports?.map((p) => String(p.containerPort ?? "")).filter(Boolean).join(", "));
    const env = h("div", { class: "gcp-run-env" });
    for (const e of c.env ?? []) {
      const ref = e.valueSource?.secretKeyRef;
      env.append(
        h(
          "div",
          { class: "gcp-run-env-row" },
          h("code", {}, e.name),
          ref ? h("small", {}, `secret: ${ref.secret}:${ref.version ?? "latest"}`) : null
        )
      );
    }
    wrap.append(
      h(
        "div",
        { class: "gcp-card" },
        h("div", { class: "gcp-card-head" }, icon("package"), h("span", { class: "gcp-title" }, c.name || imageTag(c.image))),
        kv,
        c.env?.length ? h("div", { class: "gcp-card-line muted" }, `Environment (${c.env.length}, values hidden)`) : null,
        c.env?.length ? env : null
      )
    );
  }
  return wrap;
}

function openRow(row: HTMLElement, open: () => void): void {
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
}

// --- Services ---------------------------------------------------------------

function serviceUrls(svc: RunService): string[] {
  return [...new Set([...(svc.urls ?? []), ...(svc.uri ? [svc.uri] : [])])];
}

function serviceImages(svc: RunService): string[] {
  return (svc.template?.containers ?? []).map((c) => c.image);
}

export async function renderServices(container: HTMLElement, ctx: ViewContext): Promise<ListResult | null> {
  clear(container);
  container.append(statusLine("loading", "Loading Cloud Run services…"));
  let services: RunServiceSummary[];
  try {
    services = await listServices(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return null;
    container.replaceChildren(statusLine("error", runError(err, "Couldn't list Cloud Run services", "roles/run.viewer")));
    return null;
  }
  if (!ctx.isCurrent()) return null;
  clear(container);
  if (!services.length) {
    container.append(emptyState("package", "No Cloud Run services", "This project has no Cloud Run services in any region."));
    return null;
  }
  const rows = services.map((s) => serviceRow(s, ctx));
  const stats = h("div", { class: "list-stats" });
  container.append(h("div", { class: "gcp-list" }, ...rows), stats);
  return { rows, stats, noun: ["service", "services"] };
}

function serviceRow(svc: RunServiceSummary, ctx: ViewContext): HTMLElement {
  const badge = h("span", { class: "badge" });
  badge.append(icon("package"));
  const images = serviceImages(svc);
  const search = [svc.serviceId, svc.region, ...images, ...serviceUrls(svc), ingressText(svc.ingress), labelText(svc.labels)].join(" ");
  const line = [svc.region, imageTag(images[0]), ingressText(svc.ingress)].filter(Boolean).join(" · ");
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0, "data-search": search, "data-fav-id": `${svc.region}/${svc.serviceId}` },
    badge,
    h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title" }, svc.serviceId), h("small", {}, line)),
    readyPill(svc.ready),
    h("div", { class: "actions" }, externalLink(consoleLinks.runService(ctx.projectId, svc.region, svc.serviceId)))
  );
  openRow(row, () => nav.push(serviceScreen(ctx, svc)));
  return row;
}

export function serviceScreen(ctx: ProjectContext, initial: RunServiceSummary): Screen {
  let svc: RunServiceSummary = initial;
  let generation = 0;
  let body: HTMLElement;
  const status = h("div", { class: "gcp-detail-status" });

  return {
    title: initial.serviceId,
    subtitle: `${initial.region} · ${ctx.projectId}`,
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail");
      header.actions.append(
        iconButton("refresh", "Refresh", () => void refresh()),
        externalLink(consoleLinks.runService(ctx.projectId, svc.region, svc.serviceId))
      );
      render();
    },
    onLeave() {
      generation++;
    },
  };

  function render(): void {
    const gen = ++generation;
    const isCurrent = () => gen === generation;
    clear(body);
    const t = svc.template ?? {};

    const head = h(
      "div",
      { class: "gcp-detail-head" },
      readyPill(svc.ready),
      h("span", { class: "gcp-detail-machine" }, [svc.region, svc.latestReadyRevision ? lastSegment(svc.latestReadyRevision) : ""].filter(Boolean).join(" · "))
    );
    const condition =
      svc.ready !== "ready" && svc.terminalCondition?.message
        ? h("div", { class: "gcp-run-condition" }, statusLine(svc.ready === "failed" ? "error" : "info", svc.terminalCondition.message))
        : null;

    const urls = h("div", { class: "gcp-cards" });
    const list = serviceUrls(svc);
    if (!list.length) urls.append(h("div", { class: "gcp-muted" }, "No URL yet."));
    for (const url of list) {
      const copyBtn = iconButton("copy", "Copy URL", () => void copyText(url, copyBtn));
      urls.append(
        h("div", { class: "gcp-run-url" }, h("code", {}, url), copyBtn, externalLink(url, "Open in a new tab"))
      );
    }

    const meta = metaList();
    const scaling = t.scaling;
    meta.row("Min instances", scaling?.minInstanceCount ?? 0);
    meta.row("Max instances", scaling?.maxInstanceCount);
    meta.row("Concurrency", t.maxInstanceRequestConcurrency);
    meta.row("Timeout", formatDuration(t.timeout));
    meta.row("Ingress", ingressText(svc.ingress));
    meta.row("Authentication", svc.invokerIamDisabled ? "public (invoker IAM check off)" : undefined);
    meta.row("Service account", t.serviceAccount);
    meta.row("VPC connector", t.vpcAccess?.connector ? lastSegment(t.vpcAccess.connector) : undefined);
    meta.row("Last modified", [formatTime(svc.updateTime), svc.lastModifier].filter(Boolean).join(" by "));
    meta.row("Created", [formatTime(svc.createTime), svc.creator].filter(Boolean).join(" by "));
    meta.row("Labels", labelText(svc.labels));
    meta.row("Description", svc.description);

    const revisions = h("div", {}, statusLine("loading", "Loading revisions…"));
    void loadRevisions(revisions, isCurrent);

    body.append(
      status,
      head,
      condition ?? "",
      section(list.length > 1 ? "URLs" : "URL", urls),
      section("Containers", containerCards(t.containers, true)),
      section("Details", meta.el),
      section("Traffic", trafficList()),
      section("Revisions", revisions)
    );
  }

  function trafficList(): HTMLElement {
    const wrap = h("div", { class: "gcp-cards" });
    const traffic = svc.trafficStatuses ?? [];
    if (!traffic.length) wrap.append(h("div", { class: "gcp-muted" }, "No traffic assigned."));
    for (const tr of traffic) {
      const latest = tr.type?.endsWith("LATEST");
      const target = latest ? `latest${svc.latestReadyRevision ? ` (${lastSegment(svc.latestReadyRevision)})` : ""}` : tr.revision ?? "";
      wrap.append(
        h(
          "div",
          { class: "gcp-card" },
          h(
            "div",
            { class: "gcp-card-head" },
            h("span", { class: "gcp-run-percent" }, `${tr.percent ?? 0}%`),
            h("span", { class: "gcp-title" }, target),
            tr.tag ? h("span", { class: "gcp-pill muted" }, tr.tag) : null
          ),
          tr.uri ? h("div", { class: "gcp-card-line muted" }, tr.uri) : null
        )
      );
    }
    return wrap;
  }

  // Serving percent per revision id, from trafficStatuses ("latest" counted
  // against the latest ready revision).
  function servingPercent(): Map<string, number> {
    const out = new Map<string, number>();
    for (const tr of svc.trafficStatuses ?? []) {
      const rev = tr.type?.endsWith("LATEST") ? lastSegment(svc.latestReadyRevision) : tr.revision;
      if (rev && tr.percent) out.set(rev, (out.get(rev) ?? 0) + tr.percent);
    }
    return out;
  }

  async function loadRevisions(container: HTMLElement, isCurrent: () => boolean): Promise<void> {
    let revisions: RunRevisionSummary[];
    try {
      revisions = await listRevisions(ctx.creds, svc.name);
    } catch (err) {
      if (!isCurrent()) return;
      container.replaceChildren(statusLine("error", runError(err, "Couldn't list revisions", "roles/run.viewer")));
      return;
    }
    if (!isCurrent()) return;
    if (!revisions.length) {
      container.replaceChildren(h("div", { class: "gcp-muted" }, "No revisions."));
      return;
    }
    const serving = servingPercent();
    container.replaceChildren(
      h(
        "div",
        { class: "gcp-cards" },
        ...revisions.map((r) => {
          const pct = serving.get(r.revisionId);
          return h(
            "div",
            { class: "gcp-card" },
            h(
              "div",
              { class: "gcp-card-head" },
              icon("layers"),
              h("span", { class: "gcp-title" }, r.revisionId),
              h("span", { class: "spacer" }),
              pct ? h("span", { class: "gcp-pill ok" }, `${pct}%`) : null,
              readyPill(r.ready)
            ),
            h("div", { class: "gcp-card-line muted" }, [formatTime(r.createTime), imageTag(r.containers?.[0]?.image)].filter(Boolean).join(" · "))
          );
        })
      )
    );
  }

  async function refresh(): Promise<void> {
    const gen = generation;
    status.replaceChildren(statusLine("loading", "Refreshing…"));
    try {
      const next = await getService(ctx.creds, svc.name);
      if (gen !== generation) return;
      svc = { ...next, serviceId: svc.serviceId, region: svc.region, ready: readiness(next.terminalCondition) };
      clear(status);
      render();
    } catch (err) {
      if (gen !== generation) return;
      status.replaceChildren(statusLine("error", runError(err, "Couldn't refresh", "roles/run.viewer")));
    }
  }
}

// --- Jobs -------------------------------------------------------------------

// "EXECUTION_SUCCEEDED" → "succeeded"; no completion yet → "running".
function lastRunText(job: RunJobSummary): string {
  const e = job.latestCreatedExecution;
  if (!e?.createTime) return "never run";
  const status = e.completionTime ? (e.completionStatus ?? "").replace(/^EXECUTION_/, "").toLowerCase() || "done" : "running";
  return `last run ${status} ${formatTime(e.completionTime ?? e.createTime)}`;
}

export async function renderJobs(container: HTMLElement, ctx: ViewContext): Promise<ListResult | null> {
  clear(container);
  container.append(statusLine("loading", "Loading Cloud Run jobs…"));
  let jobs: RunJobSummary[];
  try {
    jobs = await listJobs(ctx.creds, ctx.projectId);
  } catch (err) {
    if (!ctx.isCurrent()) return null;
    container.replaceChildren(statusLine("error", runError(err, "Couldn't list Cloud Run jobs", "roles/run.viewer")));
    return null;
  }
  if (!ctx.isCurrent()) return null;
  clear(container);
  if (!jobs.length) {
    container.append(emptyState("playCircle", "No Cloud Run jobs", "This project has no Cloud Run jobs in any region."));
    return null;
  }
  const rows = jobs.map((j) => jobRow(j, ctx));
  const stats = h("div", { class: "list-stats" });
  container.append(h("div", { class: "gcp-list" }, ...rows), stats);
  return { rows, stats, noun: ["job", "jobs"] };
}

function jobRow(job: RunJobSummary, ctx: ViewContext): HTMLElement {
  const badge = h("span", { class: "badge" });
  badge.append(icon("playCircle"));
  const images = (job.template?.template?.containers ?? []).map((c) => c.image);
  const search = [job.jobId, job.region, ...images, labelText(job.labels)].join(" ");
  const line = [job.region, `tasks ${job.template?.taskCount ?? 1}`, lastRunText(job)].join(" · ");
  const row = h(
    "div",
    { class: "row selectable gcp-row", tabindex: 0, "data-search": search, "data-fav-id": `${job.region}/${job.jobId}` },
    badge,
    h("div", { class: "name gcp-two-line" }, h("span", { class: "gcp-title" }, job.jobId), h("small", {}, line)),
    readyPill(job.ready),
    h("div", { class: "actions" }, externalLink(consoleLinks.runJob(ctx.projectId, job.region, job.jobId)))
  );
  openRow(row, () => nav.push(jobScreen(ctx, job, ctx.markChanged)));
  return row;
}

// The job detail page. Run now starts an execution with the saved config;
// `onChanged` tells the list to reload (its "last run" line) on return.
export function jobScreen(ctx: ProjectContext, job: RunJobSummary, onChanged?: () => void): Screen {
  let generation = 0;
  let body: HTMLElement;
  let executions: HTMLElement;
  const status = h("div", { class: "gcp-detail-status" });

  return {
    title: job.jobId,
    subtitle: `${job.region} · ${ctx.projectId}`,
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail");
      header.actions.append(
        iconButton("refresh", "Refresh executions", () => void loadExecutions()),
        externalLink(consoleLinks.runJob(ctx.projectId, job.region, job.jobId))
      );
      render();
    },
    onLeave() {
      generation++;
    },
  };

  function render(): void {
    clear(body);
    const exec = job.template ?? {};
    const task = exec.template ?? {};

    const runBtn = h("button", { type: "button", class: "btn small primary" }, icon("play"), "Run now");
    runBtn.addEventListener("click", () => void runNow(runBtn));
    const head = h(
      "div",
      { class: "gcp-detail-head" },
      readyPill(job.ready),
      h("span", { class: "gcp-detail-machine" }, job.region),
      h("span", { class: "spacer" }),
      runBtn
    );
    const condition =
      job.ready !== "ready" && job.terminalCondition?.message
        ? h("div", { class: "gcp-run-condition" }, statusLine(job.ready === "failed" ? "error" : "info", job.terminalCondition.message))
        : null;

    const meta = metaList();
    meta.row("Tasks", exec.taskCount ?? 1);
    meta.row("Parallelism", exec.parallelism || undefined);
    meta.row("Task timeout", formatDuration(task.timeout));
    meta.row("Max retries", task.maxRetries);
    meta.row("Service account", task.serviceAccount);
    meta.row("Executions", job.executionCount);
    meta.row("Last modified", formatTime(job.updateTime));
    meta.row("Created", [formatTime(job.createTime), job.creator].filter(Boolean).join(" by "));
    meta.row("Labels", labelText(job.labels));

    executions = h("div", {});
    body.append(
      status,
      head,
      condition ?? "",
      section("Details", meta.el),
      section("Containers", containerCards(task.containers, false)),
      section("Executions", executions)
    );
    void loadExecutions();
  }

  async function loadExecutions(): Promise<void> {
    const gen = ++generation;
    executions.replaceChildren(statusLine("loading", "Loading executions…"));
    let list: RunExecutionSummary[];
    try {
      list = await listExecutions(ctx.creds, job.name);
    } catch (err) {
      if (gen !== generation) return;
      executions.replaceChildren(statusLine("error", runError(err, "Couldn't list executions", "roles/run.viewer")));
      return;
    }
    if (gen !== generation) return;
    if (!list.length) {
      executions.replaceChildren(h("div", { class: "gcp-muted" }, "No executions yet."));
      return;
    }
    executions.replaceChildren(h("div", { class: "gcp-cards" }, ...list.map(executionCard)));
  }

  function executionCard(e: RunExecutionSummary): HTMLElement {
    const total = e.taskCount ?? 0;
    const counts = [
      `${e.succeededCount ?? 0}/${total} succeeded`,
      e.failedCount ? `${e.failedCount} failed` : "",
      e.runningCount ? `${e.runningCount} running` : "",
      e.cancelledCount ? `${e.cancelledCount} cancelled` : "",
    ].filter(Boolean);
    const started = e.startTime ?? e.createTime;
    const duration = elapsed(started, e.completionTime);
    return h(
      "div",
      { class: "gcp-card" },
      h(
        "div",
        { class: "gcp-card-head" },
        icon("clock"),
        h("span", { class: "gcp-title" }, e.executionId),
        h("span", { class: "spacer" }),
        executionPill(e.status),
        e.logUri ? externalLink(e.logUri, "Open logs in a new tab") : null
      ),
      h(
        "div",
        { class: "gcp-card-line" },
        [started ? `started ${formatTime(started)}` : "", duration ? `${duration}${e.completionTime ? "" : " so far"}` : ""].filter(Boolean).join(" · ")
      ),
      h("div", { class: "gcp-card-line muted" }, counts.join(" · "))
    );
  }

  async function runNow(button: HTMLButtonElement): Promise<void> {
    const ok = await confirmDialog({
      title: `Run ${job.jobId}?`,
      message: "Starts a new execution with the job's saved configuration. It's billed like any run.",
      confirmLabel: "Run",
    });
    if (!ok) return;
    button.disabled = true;
    status.replaceChildren(statusLine("loading", `Starting ${job.jobId}…`));
    try {
      await runJob(ctx.creds, job.name);
      onChanged?.();
      status.replaceChildren(statusLine("info", "Execution started"));
      await loadExecutions();
    } catch (err) {
      status.replaceChildren(statusLine("error", runError(err, "Couldn't run the job", "run.jobs.run (roles/run.developer)")));
    } finally {
      button.disabled = false;
    }
  }
}
