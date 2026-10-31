// Stack navigation for the side panel, like the mobile app's: Home
// (connections) → a resource list → a detail page. Each pushed screen gets
// its own body; going back pops it and re-shows the previous one exactly as
// it was left (its DOM is only hidden, never rebuilt).

export interface ScreenHeader {
  // Icon buttons/links the screen wants at the right of the header bar.
  actions: HTMLElement;
  setTitle(title: string, subtitle?: string): void;
}

export interface Screen {
  title: string;
  subtitle?: string;
  // Called once, when pushed, with an empty body the screen owns.
  render(body: HTMLElement, header: ScreenHeader): void | Promise<void>;
  // Called when popped (or replaced), before its DOM is removed.
  onLeave?(): void;
  // Called when the screen becomes visible again after a pop above it.
  onShow?(): void;
}

export interface Navigator {
  push(screen: Screen): void;
  pop(): void;
  // Pops back to Home and re-renders it (e.g. after connections changed).
  home(): void;
  depth(): number;
}

let current: Navigator | null = null;

export function setNavigator(nav: Navigator): void {
  current = nav;
}

export const nav: Navigator = {
  push: (s) => current?.push(s),
  pop: () => current?.pop(),
  home: () => current?.home(),
  depth: () => current?.depth() ?? 0,
};
