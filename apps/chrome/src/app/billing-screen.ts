// Billing for any vendor (port of the mobile app's Billing + billing-detail):
// month-to-date total, balance (Tencent), cost by service, a year of
// history; each service drills into its bill by usage and by resource.
// Vendor-neutral: the caller passes loaders returning core billing shapes
// (packages/core/src/billing.ts).
import { shortServiceName, type MonthToDateCost, type ServiceCost, type ServiceCostDetail } from "@cloud-console/core/billing";
import { dayLabel, formatCurrency, monthLabel } from "@cloud-console/core/format";
import { append, clear, h, icon, iconButton, statusLine } from "../gcp/dom.ts";
import { errorMessage } from "../sidepanel/dom.ts";
import { nav, type Screen } from "./nav.ts";

export interface BillingLoaders {
  // Connection name, shown under the title.
  subtitle: string;
  // `fresh`: an explicit refresh — skip the cache.
  monthToDate(fresh: boolean): Promise<MonthToDateCost>;
  history(fresh: boolean): Promise<MonthToDateCost[]>;
  serviceDetail(service: ServiceCost, bill: MonthToDateCost, fresh: boolean): Promise<ServiceCostDetail>;
}

function section(title: string | null, ...content: (Node | null)[]): HTMLElement {
  return h("section", { class: "gcp-detail-section" }, title ? h("h3", {}, title) : null, ...content);
}

function bigTotal(amount: number, unit: string, caption: string): HTMLElement {
  return h("div", { class: "bill-total" }, h("div", { class: "bill-total-amount" }, formatCurrency(amount, unit)), h("small", {}, caption));
}

function costRow(name: string, amount: number, unit: string, onOpen?: () => void, small = false): HTMLElement {
  const row = h(
    onOpen ? "button" : "div",
    { type: onOpen ? "button" : undefined, class: `bill-row${small ? " small" : ""}` },
    h("span", { class: "bill-name", title: name }, name),
    h("span", { class: "bill-amount" }, formatCurrency(amount, unit)),
    onOpen ? h("span", { class: "gcp-chevron" }, icon("chevronRight")) : null
  );
  if (onOpen) row.addEventListener("click", onOpen);
  return row;
}

function muted(text: string): HTMLElement {
  return h("div", { class: "gcp-muted bill-muted" }, text);
}

// A folding group (<details>) whose summary is a name + amount row.
function costGroup(name: string, amount: number, unit: string, children: () => HTMLElement[]): HTMLElement {
  const summary = h(
    "summary",
    { class: "bill-row" },
    h("span", { class: "gcp-chevron" }, icon("chevronRight")),
    h("span", { class: "bill-name", title: name }, name),
    h("span", { class: "bill-amount" }, formatCurrency(amount, unit))
  );
  const details = h("details", { class: "bill-group" }, summary);
  let filled = false;
  details.addEventListener("toggle", () => {
    if (!details.open || filled) return;
    filled = true;
    details.append(h("div", { class: "bill-group-body" }, ...children()));
  });
  return details;
}

export function kindBillingScreen(loaders: BillingLoaders): Screen {
  let body: HTMLElement;
  let generation = 0;

  const serviceRows = (bill: MonthToDateCost) =>
    bill.byService.map((s) => costRow(shortServiceName(s.serviceName), s.amount, bill.unit, () => nav.push(billingDetailScreen(loaders, s, bill))));

  async function load(fresh: boolean): Promise<void> {
    const gen = ++generation;
    body.replaceChildren(statusLine("loading", "Loading costs…"));
    const historyPromise = loaders.history(fresh);
    historyPromise.catch(() => undefined);
    let cost: MonthToDateCost;
    try {
      cost = await loaders.monthToDate(fresh);
    } catch (err) {
      if (gen !== generation) return;
      body.replaceChildren(statusLine("error", `Couldn't load billing: ${errorMessage(err)}`));
      return;
    }
    if (gen !== generation) return;
    const history = h("div", {}, statusLine("loading", "Loading history…"));
    clear(body);
    append(
      body,
      section(null, bigTotal(cost.total, cost.unit, `Month to date${cost.isEstimated ? " · estimated" : ""}`)),
      cost.balance !== undefined
        ? section("Balance", h("div", { class: `bill-row${cost.balance < 0 ? " negative" : ""}` }, h("span", { class: "bill-name" }, "Remaining"), h("span", { class: "bill-amount" }, formatCurrency(cost.balance, cost.unit))))
        : null,
      cost.byService.length === 0 ? section(null, muted("No costs recorded yet this month.")) : section("By service", h("div", { class: "bill-list" }, ...serviceRows(cost))),
      section("History", history)
    );
    try {
      const bills = await historyPromise;
      if (gen !== generation) return;
      history.replaceChildren(
        bills.length === 0
          ? muted("No history yet.")
          : h(
              "div",
              { class: "bill-list" },
              ...bills.map((bill) => costGroup(monthLabel(bill.periodStart), bill.total, bill.unit, () => (bill.byService.length === 0 ? [muted("No costs recorded.")] : serviceRows(bill))))
            )
      );
    } catch (err) {
      if (gen !== generation) return;
      history.replaceChildren(statusLine("error", errorMessage(err)));
    }
  }

  return {
    title: "Billing",
    subtitle: loaders.subtitle,
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail", "bill-screen");
      header.actions.append(iconButton("refresh", "Refresh", () => void load(true)));
      void load(false);
    },
    onLeave() {
      generation++;
    },
  };
}

function resourceHeader(display: string): string {
  if (display === "S3" || display === "COS") return "By bucket";
  if (display === "Lambda" || display === "SCF") return "By function";
  if (display === "EC2" || display === "CVM") return "By instance";
  if (display === "RDS" || display === "MySQL") return "By database";
  return "By resource";
}

// ARNs shortened to their last segment.
function resourceLabel(id: string): string {
  if (!id || id === "NoResourceId") return "Not tied to a resource";
  if (!id.startsWith("arn:")) return id;
  return id.split(/[:/]/).pop() || id;
}

function billingDetailScreen(loaders: BillingLoaders, service: ServiceCost, bill: MonthToDateCost): Screen {
  const display = shortServiceName(service.serviceName);
  let body: HTMLElement;
  let generation = 0;

  async function load(fresh: boolean): Promise<void> {
    const gen = ++generation;
    body.replaceChildren(statusLine("loading", `Loading ${display} costs…`));
    let detail: ServiceCostDetail;
    try {
      detail = await loaders.serviceDetail(service, bill, fresh);
    } catch (err) {
      if (gen !== generation) return;
      body.replaceChildren(statusLine("error", `Couldn't load ${display} costs: ${errorMessage(err)}`));
      return;
    }
    if (gen !== generation) return;
    const unit = detail.unit;
    const footer = [
      detail.resourcesFrom && detail.resourcesTo
        ? `${dayLabel(detail.resourcesFrom)} – ${dayLabel(detail.resourcesTo)}` + (detail.resourcesFrom > bill.periodStart ? " (last 14 days kept by AWS)" : "")
        : undefined,
      detail.resourcesNote,
    ].filter(Boolean);
    body.replaceChildren(
      section(null, bigTotal(detail.total, unit, `${service.serviceName} · ${monthLabel(bill.periodStart)}`)),
      section(
        "By usage",
        detail.usage.length === 0 ? muted("No usage recorded.") : h("div", { class: "bill-list" }, ...detail.usage.map((u) => costRow(u.name, u.amount, unit)))
      ),
      section(
        resourceHeader(display),
        detail.resources.length === 0 && !detail.resourcesNote
          ? muted("No per-resource costs recorded.")
          : detail.resources.length
            ? h(
                "div",
                { class: "bill-list" },
                ...detail.resources.map((r) => costGroup(resourceLabel(r.resourceID), r.amount, unit, () => r.usage.map((u) => costRow(u.name, u.amount, unit, undefined, true))))
              )
            : null,
        footer.length ? h("div", { class: "gcp-muted bill-footer" }, footer.join("\n")) : null
      )
    );
  }

  return {
    title: display,
    subtitle: monthLabel(bill.periodStart),
    render(el, header) {
      body = el;
      body.classList.add("gcp-detail", "bill-screen");
      header.actions.append(iconButton("refresh", "Refresh", () => void load(true)));
      void load(false);
    },
    onLeave() {
      generation++;
    },
  };
}
