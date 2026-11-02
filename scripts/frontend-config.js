const supportedEnvironments = new Set(["local", "preview", "production"]);

export function createFrontendConfig({ appEnv = "local" } = {}) {
  if (!supportedEnvironments.has(appEnv)) {
    throw new TypeError(`Unsupported frontend environment: ${appEnv}`);
  }

  return [
    `export const APP_ENV = ${JSON.stringify(appEnv)};`,
    'export const API_BASE_URL = "/api";',
    "",
  ].join("\n");
}
