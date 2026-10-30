// Top-level sections of the side panel ("Storage", "Google Cloud", …).
// A feature module calls registerSection() at import time; the shell
// (shell/shell.ts) renders a switcher for whatever got registered and
// mounts each section into its own container the first time it's opened.
// Only registered sections appear — nothing is listed before it exists.

export interface Section {
  id: string;
  title: string;
  icon: string; // a name from lib/icons.ts (unknown names fall back to "file")
  // Called once, on first activation, with an empty container the section
  // owns from then on; switching away only hides it, so state survives.
  render(container: HTMLElement): void | Promise<void>;
}

const sections: Section[] = [];
const listeners = new Set<() => void>();

export function registerSection(section: Section): void {
  if (sections.some((s) => s.id === section.id)) {
    throw new Error(`Section "${section.id}" is already registered`);
  }
  sections.push(section);
  for (const fn of listeners) fn();
}

export function getSections(): readonly Section[] {
  return sections;
}

// Lets the shell pick up a section registered after it started.
export function onSectionsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
