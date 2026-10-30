// npm-workspaces monorepo: watch the repo root so Metro sees packages/core
// (consumed from TS source) and packages/demo (fixture JSON), and resolve
// hoisted dependencies from the root node_modules.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// @cloud-console/core exposes "./*": "./src/*.ts".
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
