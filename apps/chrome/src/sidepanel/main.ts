// Side panel entry. Each feature module registers its section on import;
// the shell then renders the switcher and opens the last-used section.
// Storage first, so it's the default for a fresh install.
import "./storage-section.ts";
import "../gcp/index.ts";
import { startShell } from "../shell/shell.ts";

void startShell(document.getElementById("sectionTabs")!, document.getElementById("sectionHost")!);
