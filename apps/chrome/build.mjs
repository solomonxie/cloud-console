// Bundles the extension into dist/: TypeScript entries (plus
// @cloud-console/core, consumed from source) via esbuild, then the static
// assets (manifest, html, css, icons) copied alongside. Load dist/ unpacked.
//   node build.mjs           one-off build
//   node build.mjs --watch   rebuild on change
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "static"), dist, { recursive: true });

const options = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    sidepanel: join(root, "src/sidepanel/main.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
