import { requestSession } from "./auth-session.js";

export function initializeAuthUI({
  document: documentRef,
  fetchImpl,
  apiBaseUrl,
  onSessionChange = () => {},
}) {
  const authPanel = documentRef.querySelector(".auth-panel");
  const authStatus = documentRef.querySelector("#auth-status");
  const authActions = documentRef.querySelector("#auth-actions");
  const logoutButton = documentRef.querySelector("#logout-button");
  const retryButton = documentRef.querySelector("#retry-session-button");

  if (
    !(authPanel instanceof HTMLElement) ||
    !(authStatus instanceof HTMLElement) ||
    !(authActions instanceof HTMLElement) ||
    !(logoutButton instanceof HTMLButtonElement) ||
    !(retryButton instanceof HTMLButtonElement)
  ) {
    throw new Error("Os elementos da interface de autenticação não foram encontrados.");
  }

  let latestSession = null;
  let sessionRequestId = 0;
  let logoutRequestId = 0;

  function renderSessionFailure() {
    if (latestSession?.state === "authenticated") {
      authStatus.textContent =
        `Bem-vindo, ${latestSession.displayName}. Não foi possível atualizar sua sessão.`;
      authActions.hidden = true;
      logoutButton.hidden = false;
    } else {
      authStatus.textContent =
        "Não foi possível verificar a sessão. Tente novamente.";
      authActions.hidden = false;
      logoutButton.hidden = true;
    }
    retryButton.hidden = false;
  }

  async function loadSession() {
    const requestId = ++sessionRequestId;
    authPanel.setAttribute("aria-busy", "true");
    retryButton.disabled = true;
    if (latestSession?.state !== "authenticated") {
      authStatus.textContent = "Verificando sessão...";
    }

    let session;
    try {
      session = await requestSession({ fetchImpl, apiBaseUrl });
    } catch {
      if (requestId === sessionRequestId) {
        renderSessionFailure();
      }
      return;
    } finally {
      if (requestId === sessionRequestId) {
        authPanel.setAttribute("aria-busy", "false");
        retryButton.disabled = false;
      }
    }

    if (requestId !== sessionRequestId) {
      return;
    }

    latestSession = session;
    onSessionChange(session);
    retryButton.hidden = true;
    if (session.state === "authenticated") {
      authStatus.textContent = `Bem-vindo, ${session.displayName}.`;
      authActions.hidden = true;
      logoutButton.hidden = false;
      return;
    }

    authStatus.textContent = "Você ainda não entrou.";
    authActions.hidden = false;
    logoutButton.hidden = true;
  }

  async function logout() {
    const requestId = ++sessionRequestId;
    const currentLogoutId = ++logoutRequestId;
    logoutButton.disabled = true;
    retryButton.disabled = true;
    authPanel.setAttribute("aria-busy", "true");
    authStatus.textContent = "Encerrando sessão...";
    try {
      const response = await fetchImpl(`${apiBaseUrl}/auth/logout`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error("Logout request failed.");
      }
      if (requestId !== sessionRequestId) {
        return;
      }
      latestSession = null;
      onSessionChange(null);
      await loadSession();
    } catch {
      if (currentLogoutId === logoutRequestId) {
        renderSessionFailure();
        authStatus.textContent = "Não foi possível encerrar a sessão. Tente novamente.";
      }
    } finally {
      if (currentLogoutId === logoutRequestId) {
        logoutButton.disabled = false;
        retryButton.disabled = false;
        authPanel.setAttribute("aria-busy", "false");
      }
    }
  }

  retryButton.addEventListener("click", loadSession);
  logoutButton.addEventListener("click", logout);
  const initialization = loadSession();
  return {
    initialization,
    refreshSession: loadSession,
    get session() {
      return latestSession;
    },
  };
}
