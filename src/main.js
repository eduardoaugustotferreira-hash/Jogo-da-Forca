export { API_BASE_URL, APP_ENV } from "./config.js";

const appStatus = document.querySelector("#app-status");

if (!(appStatus instanceof HTMLElement)) {
  throw new Error('Elemento de status "#app-status" não encontrado.');
}

appStatus.textContent = "JavaScript carregado. A aventura começa em breve.";

const authStatus = document.querySelector("#auth-status");
const authActions = document.querySelector("#auth-actions");
const logoutButton = document.querySelector("#logout-button");

if (
  !(authStatus instanceof HTMLElement) ||
  !(authActions instanceof HTMLElement) ||
  !(logoutButton instanceof HTMLButtonElement)
) {
  throw new Error("Os elementos da interface de autenticação não foram encontrados.");
}

async function loadSession() {
  authStatus.textContent = "Verificando sessão...";
  try {
    const response = await fetch(`${API_BASE_URL}/auth/session`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("Não foi possível consultar a sessão.");
    }
    const session = await response.json();
    if (session.authenticated && typeof session.user?.displayName === "string") {
      authStatus.textContent = `Olá, ${session.user.displayName}.`;
      authActions.hidden = true;
      logoutButton.hidden = false;
      return;
    }
    authStatus.textContent = "Entre para acompanhar sua sessão.";
    authActions.hidden = false;
    logoutButton.hidden = true;
  } catch {
    authStatus.textContent = "Não foi possível verificar a sessão agora.";
    authActions.hidden = false;
    logoutButton.hidden = true;
  }
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  authStatus.textContent = "Encerrando sessão...";
  try {
    const response = await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) {
      throw new Error("Não foi possível encerrar a sessão.");
    }
    await loadSession();
  } catch {
    authStatus.textContent = "Não foi possível encerrar a sessão. Tente novamente.";
  } finally {
    logoutButton.disabled = false;
  }
});

await loadSession();
