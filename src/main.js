import { API_BASE_URL, APP_ENV } from "./config.js";
import { initializeAuthUI } from "./auth-ui.js";
import { initializeMultiplayerUI } from "./multiplayer-ui.js";

export { API_BASE_URL, APP_ENV };

const multiplayerUI = initializeMultiplayerUI({
  document,
  fetchImpl: fetch,
  apiBaseUrl: API_BASE_URL,
});
export const authUI = initializeAuthUI({
  document,
  fetchImpl: fetch,
  apiBaseUrl: API_BASE_URL,
  onSessionChange: multiplayerUI.onSessionChange,
});
await authUI.initialization;
