// Lambda: every enabled region's functions, grouped by region, and a function
// page like the mobile app's lambda.tsx — details plus a run panel: JSON
// event → live CloudWatch log of that run → response. Runs only after a
// confirmation (real side effects).
import { invoke, listFunctions, type LambdaFunctionSummary, type LambdaInvocation } from "@cloud-console/core/aws/lambda";
import { filterEvents, lambdaLogGroup, type LogEvent } from "@cloud-console/core/aws/cloudwatch-logs";
import { byteCount, formatClock } from "@cloud-console/core/format";
import { prettyJsonString } from "@cloud-console/core/detail";
import type { StorageConnection } from "@cloud-console/core/storage/connection";
import { registerKindScreen } from "../app/kind-screens.ts";
import { nav, type Screen } from "../app/nav.ts";
import { confirmDialog, h, icon, statusLine } from "../gcp/dom.ts";
import { awsKey, describe } from "./common.ts";
import { codeBlock, detailList, regionalListScreen, screenSubtitle, section } from "./ui.ts";

registerKindScreen("aws", "lambda", (conn) =>
  regionalListScreen<LambdaFunctionSummary>({
    conn,
    kind: "lambda",
    cacheKind: "lambda-functions",
    title: "Lambda Functions",
    noun: ["function", "functions"],
    filter: "Filter by name or runtime",
    emptyIcon: "zap",
    fetch: (region) => listFunctions(awsKey(conn), region),
    row: (f, region) => ({
      icon: "zap",
      title: f.name,
      subtitle: f.runtime,
      search: [f.name, f.runtime, f.description, region].join(" "),
      favId: `${region}/${f.name}`,
      onOpen: () => nav.push(lambdaScreen(conn, f, region)),
    }),
  })
);

// CloudWatch lags a few seconds behind the invoke's return.
const LOG_GRACE = 20_000;

function validJson(text: string): string | undefined {
  const trimmed = text.trim() || "{}";
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isErrorLine = (m: string) => m.includes("ERROR") || m.includes("Task timed out") || m.includes("Traceback");

export function lambdaScreen(conn: StorageConnection, fn: LambdaFunctionSummary, region: string): Screen {
  // The last event typed for this function (not a secret — like the mobile
  // app's AsyncStorage copy), in chrome.storage.local.
  const inputKey = `lambda.input.${conn.id}.${region}/${fn.name}`;
  let alive = true;
  let running = false;
  let result: LambdaInvocation | undefined;

  const input = h("textarea", { class: "aws-json-input", rows: 7, spellcheck: "false", "aria-label": "Input (JSON event)" });
  input.value = "{}";
  const invalid = h("div", { class: "aws-invalid", hidden: true }, "Not valid JSON.");
  const runBtn = h("button", { type: "button", class: "btn primary" }, icon("play"), "Run");
  const logSection = h("div", { hidden: true });
  const logBox = h("pre", { class: "gcp-serial-output aws-log" });
  const tailNote = h("div", { hidden: true }, statusLine("loading", "Waiting for logs…"));
  const resultSection = h("div", {});

  const sync = () => {
    const ok = !!validJson(input.value);
    invalid.hidden = ok;
    runBtn.disabled = running || !ok;
  };
  input.addEventListener("input", sync);
  void chrome.storage.local.get(inputKey).then((got) => {
    const v = got[inputKey];
    if (typeof v === "string") {
      input.value = v;
      sync();
    }
  });

  const showLog = (events: LogEvent[], fallback: string) => {
    logBox.replaceChildren();
    if (events.length) {
      for (const e of events) {
        logBox.append(h("div", { class: isErrorLine(e.message) ? "aws-log-error" : "" }, h("span", { class: "aws-log-time" }, `${formatClock(e.timestamp)}  `), e.message));
      }
    } else {
      logBox.textContent = fallback || "No log output.";
    }
    logBox.scrollTop = logBox.scrollHeight;
  };

  // Polls this run's log window until its REPORT line shows up, or the grace runs out.
  const tailLogs = async (from: number, latest: number, cancelled: { value: boolean }) => {
    tailNote.hidden = false;
    let finishedAt: number | undefined;
    let events: LogEvent[] = [];
    while (alive && !cancelled.value && Date.now() < latest) {
      try {
        events = await filterEvents(awsKey(conn), { logGroup: lambdaLogGroup(fn.name), from, to: latest, region });
        if (alive) showLog(events, result?.log ?? "");
        if (result?.requestID && events.some((e) => e.message.includes(`REPORT RequestId: ${result!.requestID}`))) break;
      } catch {
        // keep polling; the log group may not exist yet
      }
      if (result) {
        // The invoke's own log tail is complete when it still has the START line.
        if (result.requestID && result.log?.includes(`START RequestId: ${result.requestID}`)) break;
        finishedAt = finishedAt ?? Date.now();
        if (Date.now() - finishedAt > LOG_GRACE) break;
      }
      await sleep(2000);
    }
    if (alive) {
      tailNote.hidden = true;
      showLog(events, result?.log ?? "");
    }
  };

  const run = async () => {
    const payload = validJson(input.value);
    if (!payload) return;
    void chrome.storage.local.set({ [inputKey]: input.value });
    running = true;
    sync();
    runBtn.replaceChildren(icon("loader"), "Running…");
    result = undefined;
    resultSection.replaceChildren();
    logSection.hidden = false;
    showLog([], "");
    const started = Date.now();
    // Never look past the function's own max runtime.
    const latest = started + (fn.timeout ?? 900) * 1000 + LOG_GRACE;
    const cancelled = { value: false };
    const tail = tailLogs(started - 2000, latest, cancelled);
    try {
      const r = await invoke(awsKey(conn), fn.name, payload, region);
      result = r;
      if (alive) {
        resultSection.replaceChildren(
          section(
            "Response",
            h("div", { class: "aws-result-head" }, h("span", { class: `gcp-pill ${r.isError ? "off" : "ok"}` }, r.status)),
            codeBlock(prettyJsonString(r.response))
          )
        );
      }
    } catch (err) {
      cancelled.value = true;
      if (alive) resultSection.replaceChildren(section("Result", statusLine("error", describe(err, "Couldn't run the function"))));
    }
    running = false;
    if (alive) {
      runBtn.replaceChildren(icon("play"), "Run");
      sync();
    }
    await tail;
  };

  runBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: `Run ${fn.name}?`,
      message: "This executes the function for real, with whatever side effects it has.",
      confirmLabel: "Run",
    });
    if (ok) void run();
  });

  return {
    title: fn.name,
    subtitle: screenSubtitle(conn, region),
    render(body) {
      body.classList.add("gcp-detail");
      logSection.append(section("Logs", logBox, tailNote));
      body.append(
        section(
          "Details",
          detailList([
            ["Function", fn.name],
            ["Description", fn.description || "—"],
            ["Runtime", fn.runtime ?? "—"],
            ["Handler", fn.handler ?? "—"],
            ["Memory", fn.memorySize !== undefined ? `${fn.memorySize} MB` : "—"],
            ["Timeout", fn.timeout !== undefined ? `${fn.timeout} s` : "—"],
            ["Code size", fn.codeSize !== undefined ? byteCount(fn.codeSize) : "—"],
            ["Last modified", fn.lastModified ?? "—"],
            ["ARN", fn.arn ?? "—"],
            ["Region", region],
          ])
        ),
        section("Input (JSON event)", input, invalid, h("div", { class: "aws-run-bar" }, runBtn)),
        logSection,
        resultSection
      );
    },
    onLeave() {
      alive = false;
    },
  };
}
