const CHARACTERS = ["knight", "archer", "mage"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

export function initializeMultiplayerUI({
  document: documentRef,
  fetchImpl,
  apiBaseUrl,
  WebSocketImpl = globalThis.WebSocket,
}) {
  const panel = documentRef.querySelector("#multiplayer-panel");
  if (!panel) throw new Error("A interface multiplayer não foi encontrada.");
  const status = panel.querySelector("#multiplayer-status");
  const createButton = panel.querySelector("#create-room-button");
  const joinButton = panel.querySelector("#join-room-button");
  const codeInput = panel.querySelector("#invite-code-input");
  const codeDisplay = panel.querySelector("#invite-code");
  const roomPanel = panel.querySelector("#game-room");
  const board = panel.querySelector("#game-board");
  const keyboard = panel.querySelector("#letter-keyboard");
  const leaveButton = panel.querySelector("#leave-room-button");
  const characterSelect = panel.querySelector("#character-select");
  const characterStatus = panel.querySelector("#character-status");
  const storage = globalThis.sessionStorage;
  let session = null;
  let socket = null;
  let roomCode = null;
  let reconnectTimer = null;
  let reconnectDelay = 1_000;
  let deliberatelyClosed = false;
  let latestState = null;

  function showMessage(message) {
    status.textContent = message;
  }

  function announceAction(result) {
    if (!result) return;
    const messages = {
      correct: `Letra correta. ${result.lives} vida(s) restante(s).`,
      incorrect: `Letra incorreta. ${result.lives} vida(s) restante(s).`,
      already_guessed: "Você já tentou essa letra.",
      invalid_letter: "Escolha uma letra válida.",
      word_completed: "Palavra completa. Uma nova palavra de Deathmatch chegou.",
      round_closed: "A rodada foi adjudicada pelo servidor.",
      invalid_phase_or_payload: "Essa jogada não está disponível nesta fase.",
    };
    if (messages[result.status]) showMessage(messages[result.status]);
  }

  async function sendRoomRequest(path, { method, body } = {}) {
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result?.error;
      const message =
        code === "word_pool_unavailable" || code === "word_pair_unavailable"
          ? "Ainda não há palavras validadas suficientes para iniciar uma partida."
          : code === "room_full_or_unavailable"
            ? "Esta sala já está ocupada ou expirou."
            : code === "authentication_required"
              ? "Entre na sua conta para jogar."
              : "Não foi possível acessar a sala. Tente novamente.";
      throw new Error(message);
    }
    if (!result || typeof result !== "object") {
      throw new Error("O servidor retornou uma resposta inválida.");
    }
    return result;
  }

  characterSelect.addEventListener("change", () => {
    const names = { knight: "Cavaleiro", archer: "Arqueira", mage: "Maga" };
    characterStatus.textContent =
      `Personagem escolhido: ${names[characterSelect.value] ?? "indisponível"}.`;
  });

  async function createRoom() {
    if (!session || !CHARACTERS.includes(characterSelect.value)) return;
    deliberatelyClosed = false;
    clearTimeout(reconnectTimer);
    try {
      const result = await sendRoomRequest("/v1/rooms", {
        method: "POST",
        body: { characterId: characterSelect.value },
      });
      if (typeof result.code !== "string" || !/^[A-Z2-9]{16}$/.test(result.code)) {
        throw new Error("O servidor retornou um convite inválido.");
      }
      roomCode = result.code;
      storage?.setItem("afm-room-code", roomCode);
      codeInput.value = result.code;
      await connect();
    } catch (error) {
      showMessage(error.message);
    }
  }

  async function joinRoom() {
    if (!session) return;
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{16}$/.test(code)) {
      showMessage("Digite um convite válido de 16 caracteres.");
      return;
    }
    deliberatelyClosed = false;
    try {
      const result = await sendRoomRequest(
        `/v1/rooms/${encodeURIComponent(code)}/join`,
        {
          method: "POST",
          body: { characterId: characterSelect.value },
        },
      );
      if (result.code !== code) {
        throw new Error("A sala retornou um convite inválido.");
      }
      roomCode = result.code;
      storage?.setItem("afm-room-code", roomCode);
      await connect();
    } catch (error) {
      showMessage(error.message);
    }
  }

  function connect() {
    if (!roomCode || !session || !WebSocketImpl) {
      showMessage("Conexão em tempo real indisponível neste navegador.");
      return Promise.resolve();
    }
    if (socket && socket.readyState <= WebSocketImpl.OPEN) {
      deliberatelyClosed = true;
      socket.close();
      deliberatelyClosed = false;
    }
    const wsUrl = new URL(`${apiBaseUrl}/v1/rooms/${roomCode}/ws`, globalThis.location.href);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const connection = new WebSocketImpl(wsUrl);
    socket = connection;
    connection.addEventListener("open", () => {
      reconnectDelay = 1_000;
      showMessage("Conectado à sala.");
    });
    connection.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        showMessage("O servidor enviou uma resposta inválida.");
        return;
      }
      if (message.type === "room.snapshot" && message.state) {
        renderState(message.state);
      } else if (message.type === "room.action" && message.result?.status === "room_left") {
        roomPanel.hidden = true;
      } else if (message.type === "round.action") {
        announceAction(message.result);
      } else if (message.type === "error") {
        showMessage("Ação recusada pelo servidor. Atualize o estado da sala.");
      }
    });
    connection.addEventListener("close", () => {
      if (socket === connection && !deliberatelyClosed && roomCode && session) {
        showMessage("Conexão perdida. Tentando reconectar...");
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        reconnectTimer = setTimeout(() => connect(), delay);
      }
    });
    connection.addEventListener("error", () => {
      showMessage("Falha na conexão com a sala.");
    });
    return Promise.resolve();
  }

  function renderState(state) {
    latestState = state;
    roomPanel.hidden = false;
    codeDisplay.textContent = state.code;
    const own = state.players.find((player) => player.isYou);
    const opponent = state.players.find((player) => !player.isYou);
    panel.querySelector("#victory-art").hidden =
      !(state.phase === "completed" && own?.isWinner);
    const ownPanel = board.querySelector("#own-player");
    const opponentPanel = board.querySelector("#opponent-player");
    ownPanel.textContent = own
      ? `${own.displayName} — ${own.characterId} — ${own.score} vitória(s)`
      : "Você";
    opponentPanel.textContent = opponent
      ? `${opponent.displayName} — ${opponent.characterId} — ${opponent.score} vitória(s) — progresso ${Math.round(opponent.progress * 100)}% — ${opponent.connected ? "conectado" : "desconectado"}`
      : "Aguardando adversário...";

    const ownWord = own?.word;
    board.querySelector("#life-status").hidden = !ownWord;
    board.querySelector("#masked-word").textContent =
      ownWord?.masked ?? "Aguardando o início da rodada";
    const maximumLives = state.roundMode === "deathmatch" ? 1 : 6;
    const currentLives = ownWord?.lives ?? maximumLives;
    board.querySelector("#lives-count").textContent =
      `${currentLives} de ${maximumLives}`;
    board.querySelector("#life-indicators").replaceChildren(
      ...Array.from({ length: maximumLives }, (_, index) => {
        const indicator = documentRef.createElement("span");
        indicator.textContent = index < currentLives ? "♥" : "♡";
        return indicator;
      }),
    );
    board.querySelector("#round-info").textContent =
      state.roundNumber > 0
        ? `${state.roundMode === "deathmatch" ? "Deathmatch" : `Rodada ${state.roundNumber}`} · ${state.players.map((player) => player.score).join(" × ")}`
        : "Aguardando adversário";
    keyboard.replaceChildren(
      ...LETTERS.map((letter) => {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.textContent = letter.toLocaleUpperCase("pt-BR");
        const guessResult = ownWord?.guessResults?.[letter];
        button.disabled =
          state.phase !== "playing" ||
          !socket ||
          socket.readyState !== WebSocketImpl.OPEN ||
          Boolean(ownWord?.guessedLetters.includes(letter));
        button.setAttribute(
          "aria-label",
          guessResult === "correct"
            ? `${letter.toLocaleUpperCase("pt-BR")}, letra correta`
            : guessResult === "incorrect"
              ? `${letter.toLocaleUpperCase("pt-BR")}, letra incorreta`
              : `${letter.toLocaleUpperCase("pt-BR")}, não utilizada`,
        );
        if (guessResult) button.setAttribute("data-result", guessResult);
        button.addEventListener("click", () => guess(letter));
        return button;
      }),
    );

    const phaseMessages = {
      waiting: "Sala privada criada. Compartilhe o convite com outro jogador.",
      playing:
        state.roundMode === "deathmatch"
          ? "Deathmatch: uma vida e uma posição revelada."
          : "A rodada começou. Escolha uma letra.",
      paused: "Partida pausada enquanto um jogador reconecta.",
      between_rounds: "Rodada concluída. Preparando a próxima...",
      completed: state.winnerDisplayName
        ? `Partida encerrada. Vitória de ${state.winnerDisplayName}!`
        : "Partida encerrada.",
      cancelled:
        state.endReason === "word_pool_unavailable"
          ? "Partida cancelada: não há palavras validadas equivalentes suficientes."
          : "Sala cancelada.",
    };
    if (state.phase !== "playing") showMessage(phaseMessages[state.phase] ?? "Sala atualizada.");
    leaveButton.hidden = ["completed", "cancelled"].includes(state.phase);
    panel.querySelector("#rematch-button").hidden = state.phase !== "completed";
  }

  function guess(letter) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) return;
    socket.send(
      JSON.stringify({
        version: 1,
        type: "round.guess",
        eventId: crypto.randomUUID(),
        payload: { letter },
      }),
    );
  }

  function leaveRoom() {
    deliberatelyClosed = true;
    clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocketImpl.OPEN) {
      socket.send(
        JSON.stringify({
          version: 1,
          type: "room.leave",
          eventId: crypto.randomUUID(),
        }),
      );
      socket.close();
    }
    socket = null;
    roomCode = null;
    storage?.removeItem("afm-room-code");
    latestState = null;
    roomPanel.hidden = true;
    showMessage("Você saiu da sala.");
  }

  function onSessionChange(nextSession) {
    session = nextSession?.state === "authenticated" ? nextSession : null;
    panel.hidden = !session;
    if (!session) {
      leaveRoom();
      return;
    }
    if (!roomCode) {
      roomCode = storage?.getItem("afm-room-code") ?? null;
    }
    if (roomCode && /^[A-Z2-9]{16}$/.test(roomCode)) {
      codeInput.value = roomCode;
      void sendRoomRequest(`/v1/rooms/${encodeURIComponent(roomCode)}`)
        .then((state) => {
          renderState(state);
          deliberatelyClosed = false;
          return connect();
        })
        .catch(() => {
          roomCode = null;
          storage?.removeItem("afm-room-code");
          roomPanel.hidden = true;
          showMessage("A sala anterior não está mais disponível.");
        });
    }
  }

  createButton.addEventListener("click", createRoom);
  joinButton.addEventListener("click", joinRoom);
  leaveButton.addEventListener("click", leaveRoom);
  panel.querySelector("#rematch-button").addEventListener("click", createRoom);

  return {
    onSessionChange,
    createRoom,
    joinRoom,
    leaveRoom,
    get state() {
      return latestState;
    },
  };
}
