// Renders the section switcher (a segmented control, only shown once more
// than one section is registered) and mounts sections lazily into
// #sectionHost. The last-open section is remembered across panel opens.
import { icon } from "../lib/icons.ts";
import { getSections, onSectionsChanged, type Section } from "./registry.ts";

const LAST_SECTION_KEY = "lastSectionId";

export async function startShell(tabsEl: HTMLElement, hostEl: HTMLElement): Promise<void> {
  const mounted = new Map<string, HTMLElement>();
  let activeId: string | null = null;

  const renderTabs = () => {
    const sections = getSections();
    tabsEl.hidden = sections.length < 2;
    tabsEl.innerHTML = "";
    for (const section of sections) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section-tab";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(section.id === activeId));
      btn.classList.toggle("active", section.id === activeId);
      btn.innerHTML = `${icon(section.icon)}<span></span>`;
      btn.querySelector("span")!.textContent = section.title;
      btn.addEventListener("click", () => void activate(section));
      tabsEl.appendChild(btn);
    }
  };

  const activate = async (section: Section) => {
    activeId = section.id;
    renderTabs();
    for (const [id, el] of mounted) el.hidden = id !== section.id;
    void chrome.storage.local.set({ [LAST_SECTION_KEY]: section.id });
    if (mounted.has(section.id)) return;
    const container = document.createElement("div");
    container.className = "section-view";
    container.dataset.section = section.id;
    hostEl.appendChild(container);
    mounted.set(section.id, container);
    try {
      await section.render(container);
    } catch (err) {
      console.error(err);
      container.textContent = `Couldn't load ${section.title}: ${(err as Error)?.message ?? err}`;
    }
  };

  onSectionsChanged(() => {
    renderTabs();
    if (!activeId && getSections()[0]) void activate(getSections()[0]);
  });

  const stored = await chrome.storage.local.get(LAST_SECTION_KEY);
  const sections = getSections();
  const initial = sections.find((s) => s.id === stored[LAST_SECTION_KEY]) ?? sections[0];
  if (initial) await activate(initial);
  else renderTabs();
}
