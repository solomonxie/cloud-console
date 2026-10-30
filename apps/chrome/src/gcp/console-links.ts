// Deep links into console.cloud.google.com for each item.

const CONSOLE = "https://console.cloud.google.com";

function q(project: string): string {
  return `?project=${encodeURIComponent(project)}`;
}

export const consoleLinks = {
  project: (project: string) => `${CONSOLE}/home/dashboard${q(project)}`,
  instances: (project: string) => `${CONSOLE}/compute/instances${q(project)}`,
  instance: (project: string, zone: string, name: string) =>
    `${CONSOLE}/compute/instancesDetail/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(name)}${q(project)}`,
  instanceGroups: (project: string) => `${CONSOLE}/compute/instanceGroups/list${q(project)}`,
  instanceGroup: (project: string, location: string, name: string) =>
    `${CONSOLE}/compute/instanceGroups/details/${encodeURIComponent(location)}/${encodeURIComponent(name)}${q(project)}`,
  secrets: (project: string) => `${CONSOLE}/security/secret-manager${q(project)}`,
  secret: (project: string, secretId: string) =>
    `${CONSOLE}/security/secret-manager/secret/${encodeURIComponent(secretId)}/versions${q(project)}`,
};
