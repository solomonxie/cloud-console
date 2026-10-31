// Favorites: items the user starred in a list, pinned above the rest. Kept
// only in chrome.storage.local (key "favorites") as { [scope]: ids[] }, where
// a scope names one list (e.g. "gcp:<account>:<project>:gceInstances") and an
// id is the item's stable key within it.
import { icon } from "./icons.ts";

const FAVORITES_KEY = "favorites";

type FavoriteMap = Record<string, string[]>;

// Toggles read-modify-write the whole map; chain them so quick clicks on
// different stars don't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<FavoriteMap> {
  const stored = await chrome.storage.local.get(FAVORITES_KEY);
  return (stored[FAVORITES_KEY] as FavoriteMap | undefined) ?? {};
}

export async function loadFavorites(scope: string): Promise<Set<string>> {
  const all = await readAll();
  return new Set(all[scope] ?? []);
}

// Flips one item; resolves to its new state (true = now a favorite).
export function toggleFavorite(scope: string, id: string): Promise<boolean> {
  const next = queue.then(async () => {
    const all = await readAll();
    const ids = new Set(all[scope] ?? []);
    const on = !ids.has(id);
    if (on) ids.add(id);
    else ids.delete(id);
    if (ids.size) all[scope] = [...ids];
    else delete all[scope];
    await chrome.storage.local.set({ [FAVORITES_KEY]: all });
    return on;
  });
  queue = next.catch(() => undefined);
  return next;
}

function setStar(btn: HTMLButtonElement, on: boolean): void {
  const title = on ? "Remove from favorites" : "Add to favorites";
  btn.classList.toggle("fav-on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.title = title;
  btn.setAttribute("aria-label", title);
}

// A star icon button. `onToggle` does the work and returns the new state.
// Never lets the click (or Enter) reach the row, which would open it.
export function starButton(isFav: boolean, onToggle: () => Promise<boolean> | boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn fav-btn";
  btn.innerHTML = icon("star");
  setStar(btn, isFav);
  let busy = false;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (busy) return;
    busy = true;
    try {
      setStar(btn, await onToggle());
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });
  return btn;
}

// A star bound to one item of `scope`: toggles it in storage, keeps `favs`
// in sync and calls `onChange` (typically to re-pin).
export function favoriteButton(scope: string, id: string, favs: Set<string>, onChange: () => void): HTMLButtonElement {
  return starButton(favs.has(id), async () => {
    const on = await toggleFavorite(scope, id);
    if (on) favs.add(id);
    else favs.delete(id);
    onChange();
    return on;
  });
}

// Reorders `rows` (given in their original order, each with data-fav-id)
// inside `container` so favorites come first; both groups keep their
// original order. The block stays where it was relative to other children
// (e.g. a ".." row or a filter box before it). Rows no longer in
// `container` are ignored.
export function pinFavorites(container: HTMLElement, rows: HTMLElement[], favs: Set<string>): void {
  const live = rows.filter((r) => r.parentElement === container);
  if (!live.length) return;
  const set = new Set(live);
  let first: Element | null = container.firstElementChild;
  while (first && !set.has(first as HTMLElement)) first = first.nextElementSibling;
  if (!first) return;
  const isFav = (r: HTMLElement) => favs.has(r.dataset.favId ?? "");
  const ordered = [...live.filter(isFav), ...live.filter((r) => !isFav(r))];
  let after: Node | null = first.previousSibling;
  for (const row of ordered) {
    container.insertBefore(row, after ? after.nextSibling : container.firstChild);
    after = row;
  }
}

// For lists whose rows carry data-fav-id and an `.actions` element: loads
// the scope's favorites, puts a star in each row's actions and pins the
// favorites on top (again on every toggle).
export async function decorateFavorites(scope: string, rows: HTMLElement[]): Promise<void> {
  const marked = rows.filter((r) => r.dataset.favId);
  const container = marked[0]?.parentElement;
  if (!container) return;
  const favs = await loadFavorites(scope);
  const repin = () => pinFavorites(container, marked, favs);
  for (const row of marked) {
    const id = row.dataset.favId ?? "";
    const actions = row.querySelector(".actions");
    if (!actions || actions.querySelector(".fav-btn")) continue;
    actions.prepend(favoriteButton(scope, id, favs, repin));
  }
  repin();
}
