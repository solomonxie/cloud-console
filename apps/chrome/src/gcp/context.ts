import type { GoogleCredentials } from "@cloud-console/core/gcp/auth";

// One account + one project: what every GCP list and detail screen works in.
export interface ProjectContext {
  accountId: string;
  creds: GoogleCredentials;
  projectId: string;
}

// A list renderer's context. `isCurrent` is false once the project switched
// or the list was reloaded, so a stale response doesn't render.
// `markChanged` asks the list to reload when the user comes back to it
// (e.g. after starting a VM on its detail screen).
export interface ViewContext extends ProjectContext {
  isCurrent: () => boolean;
  markChanged: () => void;
  // True on an explicit refresh: skip session caches.
  fresh: boolean;
}

// What a list renderer hands back so the screen can filter it: one element
// per item (searchable text in data-search) and the stats line to update.
export interface ListResult {
  rows: HTMLElement[];
  stats: HTMLElement;
  noun: [singular: string, plural: string];
}

// Favorites scope of one list in one project (see lib/favorites.ts); `kind`
// is the GcpKind, e.g. "gceInstances". Rows give their id in data-fav-id.
export function favoritesScope(ctx: ProjectContext, kind: string): string {
  return `gcp:${ctx.accountId}:${ctx.projectId}:${kind}`;
}
