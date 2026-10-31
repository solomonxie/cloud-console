// The side panel's stack navigator (implements app/nav.ts): one persistent
// header bar over a stack of screen bodies. Pushing hides the body below
// (its DOM and state stay); popping removes the top one and re-shows the
// one under it.
import { icon } from "../lib/icons.ts";
import { setNavigator, type Navigator, type Screen, type ScreenHeader } from "./nav.ts";

interface Entry {
  screen: Screen;
  body: HTMLElement;
  // Detached while another screen is on top; re-attached to the header on show.
  actions: HTMLElement;
  title: string;
  subtitle?: string;
}

export interface NavigatorEls {
  backBtn: HTMLButtonElement;
  brand: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  actions: HTMLElement;
  host: HTMLElement;
}

export function startNavigator(els: NavigatorEls, home: () => Screen): Navigator {
  const stack: Entry[] = [];
  els.backBtn.innerHTML = icon("chevronLeft");

  const top = () => stack[stack.length - 1];

  // Shows the top entry's title/actions; the brand mark and no back button
  // on the root screen, a back button everywhere else.
  const syncHeader = () => {
    const entry = top();
    if (!entry) return;
    const isRoot = stack.length === 1;
    els.backBtn.hidden = isRoot;
    els.brand.hidden = !isRoot;
    els.title.textContent = entry.title;
    els.title.title = entry.title;
    els.subtitle.textContent = entry.subtitle ?? "";
    els.subtitle.hidden = !entry.subtitle;
    els.actions.replaceChildren(entry.actions);
    document.title = isRoot ? "Cloud Console" : `${entry.title} — Cloud Console`;
  };

  const leave = (entry: Entry) => {
    try {
      entry.screen.onLeave?.();
    } catch (err) {
      console.error(err);
    }
    entry.body.remove();
  };

  const push = (screen: Screen) => {
    const below = top();
    if (below) below.body.hidden = true;
    const body = document.createElement("section");
    body.className = "screen";
    const actions = document.createElement("div");
    actions.className = "screen-actions";
    const entry: Entry = { screen, body, actions, title: screen.title, subtitle: screen.subtitle };
    stack.push(entry);
    els.host.appendChild(body);
    const header: ScreenHeader = {
      actions,
      setTitle(title, subtitle) {
        entry.title = title;
        entry.subtitle = subtitle;
        if (top() === entry) syncHeader();
      },
    };
    syncHeader();
    // A screen that throws while rendering still gets a body (with the
    // error) and a back button, rather than a blank panel.
    const fail = (err: unknown) => {
      console.error(err);
      const msg = document.createElement("div");
      msg.className = "status error";
      msg.innerHTML = `${icon("alertCircle")}<span></span>`;
      msg.querySelector("span")!.textContent = `Couldn't load ${entry.title}: ${(err as Error)?.message ?? err}`;
      body.prepend(msg);
    };
    try {
      const result = screen.render(body, header);
      if (result instanceof Promise) result.catch(fail);
    } catch (err) {
      fail(err);
    }
  };

  const pop = () => {
    if (stack.length < 2) return;
    leave(stack.pop()!);
    const entry = top()!;
    entry.body.hidden = false;
    syncHeader();
    try {
      entry.screen.onShow?.();
    } catch (err) {
      console.error(err);
    }
  };

  const goHome = () => {
    while (stack.length) leave(stack.pop()!);
    push(home());
  };

  els.backBtn.addEventListener("click", pop);
  // Alt+Left goes back, like a browser — but not inside a text field
  // (where it moves by word) or with a dialog open.
  document.addEventListener("keydown", (e) => {
    if (!(e.altKey && e.key === "ArrowLeft")) return;
    if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault();
    pop();
  });

  const navigator: Navigator = { push, pop, home: goHome, depth: () => stack.length };
  setNavigator(navigator);
  goHome();
  return navigator;
}
