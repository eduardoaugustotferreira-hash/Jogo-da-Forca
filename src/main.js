const appStatus = document.querySelector("#app-status");

if (!(appStatus instanceof HTMLElement)) {
  throw new Error('Elemento de status "#app-status" não encontrado.');
}

appStatus.textContent = "JavaScript carregado. A aventura começa em breve.";
