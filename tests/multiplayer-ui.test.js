import test from "node:test";
import assert from "node:assert/strict";

import { initializeMultiplayerUI } from "../src/multiplayer-ui.js";

class Element {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
  }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  click() {
    for (const callback of this.listeners.get("click") ?? []) callback();
  }
  emit(type) {
    for (const callback of this.listeners.get(type) ?? []) callback();
  }
  querySelector(selector) {
    return this.childrenBySelector.get(selector);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(name, value) {
    this.attributes ??= new Map();
    this.attributes.set(name, value);
  }
}

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];
  readyState = Socket.OPEN;
  listeners = new Map();
  sent = [];
  constructor(url) {
    this.url = String(url);
    Socket.instances.push(this);
  }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }
  send(message) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

function fixture() {
  const document = {
    createElement() {
      const element = new Element();
      element.type = "";
      return element;
    },
  };
  const panel = new Element();
  const selectors = [
    "#multiplayer-status",
    "#create-room-button",
    "#join-room-button",
    "#invite-code-input",
    "#invite-code",
    "#game-room",
    "#game-board",
    "#letter-keyboard",
    "#leave-room-button",
    "#character-select",
    "#character-status",
    "#rematch-button",
    "#own-player",
    "#opponent-player",
    "#masked-word",
    "#lives-count",
    "#life-status",
    "#life-indicators",
    "#round-info",
    "#victory-art",
  ];
  panel.childrenBySelector = new Map(
    selectors.map((selector) => [selector, new Element()]),
  );
  panel.querySelector = (selector) => panel.childrenBySelector.get(selector);
  panel.querySelector("#game-board").querySelector = (selector) =>
    panel.childrenBySelector.get(selector);
  panel.querySelector("#character-select").value = "knight";
  document.querySelector = (selector) =>
    selector === "#multiplayer-panel" ? panel : null;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return { code: "23456789ABCDEFGH" };
      },
    };
  };
  Socket.instances = [];
  globalThis.location = { href: "https://preview.example/" };
  const ui = initializeMultiplayerUI({
    document,
    fetchImpl,
    apiBaseUrl: "/api",
    WebSocketImpl: Socket,
  });
  return { document, panel, requests, ui };
}

test("authenticated user can create a room and receives masked game state", async () => {
  const { panel, requests, ui } = fixture();
  ui.onSessionChange({ state: "authenticated", displayName: "Player One" });
  const characterSelect = panel.querySelector("#character-select");
  characterSelect.value = "mage";
  characterSelect.emit("change");
  assert.equal(
    panel.querySelector("#character-status").textContent,
    "Personagem escolhido: Maga.",
  );
  characterSelect.value = "knight";

  await ui.createRoom();
  assert.equal(requests[0].url, "/api/v1/rooms");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(Socket.instances.length, 1);
  assert.equal(
    Socket.instances[0].url,
    "wss://preview.example/api/v1/rooms/23456789ABCDEFGH/ws",
  );
  const state = {
    code: "23456789ABCDEFGH",
    phase: "playing",
    roundNumber: 1,
    roundMode: "normal",
    winnerDisplayName: null,
    players: [
      {
        isYou: true,
        displayName: "Player One",
        characterId: "knight",
        score: 0,
        word: {
          masked: "_ a _ a",
          lives: 6,
          guessedLetters: ["a"],
          guessResults: { a: "correct" },
        },
      },
      {
        isYou: false,
        displayName: "Player Two",
        characterId: "archer",
        score: 0,
        progress: 0.25,
      },
    ],
  };
  Socket.instances[0].emit("message", {
    data: JSON.stringify({ type: "room.snapshot", state }),
  });
  assert.equal(panel.querySelector("#game-room").hidden, false);
  assert.equal(panel.querySelector("#masked-word").textContent, "_ a _ a");
  assert.equal(panel.querySelector("#lives-count").textContent, "6 de 6");
  assert.equal(panel.querySelector("#life-indicators").children.length, 6);
  assert.equal(panel.querySelector("#life-status").hidden, false);
  assert.match(panel.querySelector("#opponent-player").textContent, /desconectado/);
  assert.equal(panel.querySelector("#letter-keyboard").children.length, 26);

  const aButton = panel
    .querySelector("#letter-keyboard")
    .children.find((button) => button.textContent === "A");
  assert.equal(aButton.disabled, true);
  assert.equal(aButton.attributes.get("data-result"), "correct");
  assert.match(aButton.attributes.get("aria-label"), /letra correta/);
  const bButton = panel
    .querySelector("#letter-keyboard")
    .children.find((button) => button.textContent === "B");
  bButton.click();
  const sent = JSON.parse(Socket.instances[0].sent[0]);
  assert.equal(sent.type, "round.guess");
  assert.equal(sent.payload.letter, "b");
  assert.equal(typeof sent.eventId, "string");
  Socket.instances[0].emit("message", {
    data: JSON.stringify({
      type: "round.action",
      result: { status: "incorrect", lives: 5 },
    }),
  });
  assert.equal(
    panel.querySelector("#multiplayer-status").textContent,
    "Letra incorreta. 5 vida(s) restante(s).",
  );

  state.phase = "completed";
  state.winnerDisplayName = "Player One";
  state.players[0].isWinner = true;
  Socket.instances[0].emit("message", {
    data: JSON.stringify({ type: "room.snapshot", state }),
  });
  assert.equal(panel.querySelector("#victory-art").hidden, false);
  assert.equal(panel.querySelector("#rematch-button").hidden, false);
});

test("anonymous users cannot create rooms and session loss closes their connection", async () => {
  const { panel, requests, ui } = fixture();
  ui.onSessionChange({ state: "anonymous" });
  assert.equal(panel.hidden, true);
  await ui.createRoom();
  assert.equal(requests.length, 0);

  ui.onSessionChange({ state: "authenticated", displayName: "Player One" });
  await ui.createRoom();
  const socket = Socket.instances[0];
  ui.onSessionChange(null);
  assert.equal(panel.hidden, true);
  assert.equal(socket.readyState, 3);
});
