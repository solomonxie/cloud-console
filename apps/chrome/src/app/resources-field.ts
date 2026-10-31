// The connection forms' "Resources" section: a checkbox per implemented
// resource kind (all checked by default, at least one required). The
// storage kind, when checked, offers an optional "Limit to" bucket and,
// within it, a prefix (the hard root of browsing).
import type { ResourceKind, ResourceKindId } from "@cloud-console/core/catalog";
import { normalizePrefix, type StorageScope } from "@cloud-console/core/storage/connection";
import { h } from "../gcp/dom.ts";

export interface ResourcesFieldOpts {
  kinds: ResourceKind[];
  selected?: ResourceKindId[]; // absent = all
  // The kind that gets the "Limit to" bucket/prefix inputs, if any.
  scopeKind?: ResourceKindId;
  scope?: StorageScope;
  bucketLabel?: string;
  bucketPlaceholder?: string;
}

export type ResourcesValue =
  | { ok: true; resources?: ResourceKindId[]; storageScope?: StorageScope }
  | { ok: false; error: string };

export interface ResourcesField {
  el: HTMLElement;
  value(): ResourcesValue;
}

export function resourcesField(opts: ResourcesFieldOpts): ResourcesField {
  const boxes = new Map<ResourceKindId, HTMLInputElement>();
  const el = h("fieldset", { class: "resources-field" }, h("legend", {}, "Resources"));
  let bucketInput: HTMLInputElement | null = null;
  let prefixInput: HTMLInputElement | null = null;

  for (const kind of opts.kinds) {
    const box = h("input", { type: "checkbox", value: kind.id });
    box.checked = !opts.selected || opts.selected.includes(kind.id);
    boxes.set(kind.id, box);
    el.append(h("label", { class: "field checkbox" }, box, h("span", {}, kind.title)));

    if (kind.id !== opts.scopeKind) continue;
    bucketInput = h("input", { autocomplete: "off", spellcheck: "false", placeholder: opts.bucketPlaceholder ?? "all buckets" });
    bucketInput.value = opts.scope?.bucket ?? "";
    prefixInput = h("input", { autocomplete: "off", spellcheck: "false", placeholder: "e.g. logs/2026/" });
    prefixInput.value = opts.scope?.prefix ?? "";
    const bucket = bucketInput;
    const prefix = prefixInput;
    const syncPrefix = () => {
      prefix.disabled = !bucket.value.trim();
    };
    bucket.addEventListener("input", syncPrefix);
    syncPrefix();
    const scope = h(
      "div",
      { class: "resource-scope" },
      h("p", { class: "hint" }, "Limit to (optional) — leave empty to list every bucket this key can see."),
      h("label", { class: "field" }, h("span", {}, opts.bucketLabel ?? "Bucket name"), bucket),
      h("label", { class: "field" }, h("span", {}, "Prefix ", h("em", {}, "(optional, starting folder)")), prefix)
    );
    const syncScope = () => {
      scope.hidden = !box.checked;
    };
    box.addEventListener("change", syncScope);
    syncScope();
    el.append(scope);
  }

  return {
    el,
    value() {
      const checked = opts.kinds.filter((k) => boxes.get(k.id)?.checked).map((k) => k.id);
      if (!checked.length) return { ok: false, error: "Pick at least one resource for this connection." };
      const resources = checked.length === opts.kinds.length ? undefined : checked;
      const bucket = bucketInput?.value.trim() ?? "";
      let storageScope: StorageScope | undefined;
      if (opts.scopeKind && checked.includes(opts.scopeKind) && bucket) {
        const prefix = normalizePrefix(prefixInput?.value.trim() ?? "");
        storageScope = prefix ? { bucket, prefix } : { bucket };
      }
      return { ok: true, resources, storageScope };
    },
  };
}
