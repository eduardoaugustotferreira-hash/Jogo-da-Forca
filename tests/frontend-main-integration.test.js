import test from "node:test";
import assert from "node:assert/strict";

class FakeHTMLElement {
  constructor(hidden = false) {
    this.hidden = hidden;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  async click() {
    if (this.disabled) {
      return;
    }
    return this.listeners.get("click")?.();
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

class FakeHTMLButtonElement extends FakeHTMLElement {}

function createDocument({ missingSelector } = {}) {
  const elements = new Map([
    [".auth-panel", new FakeHTMLElement()],
    ["#auth-status", new FakeHTMLElement()],
    ["#auth-actions", new FakeHTMLElement(true)],
    ["#logout-button", new FakeHTMLButtonElement(true)],
    ["#retry-session-button", new FakeHTMLButtonElement(true)],
    ["#multiplayer-panel", new FakeHTMLElement(true)],
    ["#multiplayer-status", new FakeHTMLElement()],
    ["#create-room-button", new FakeHTMLButtonElement()],
    ["#join-room-button", new FakeHTMLButtonElement()],
    ["#invite-code-input", new FakeHTMLElement()],
    ["#invite-code", new FakeHTMLElement()],
    ["#game-room", new FakeHTMLElement(true)],
    ["#game-board", new FakeHTMLElement()],
    ["#letter-keyboard", new FakeHTMLElement()],
    ["#leave-room-button", new FakeHTMLButtonElement(true)],
    ["#character-select", new FakeHTMLElement()],
    ["#rematch-button", new FakeHTMLButtonElement(true)],
    ["#own-player", new FakeHTMLElement()],
    ["#opponent-player", new FakeHTMLElement()],
    ["#masked-word", new FakeHTMLElement()],
    ["#lives-count", new FakeHTMLElement()],
    ["#round-info", new FakeHTMLElement()],
    ["#victory-art", new FakeHTMLElement(true)],
  ]);
  elements.get("#character-select").value = "knight";
  elements.get("#multiplayer-panel").querySelector = (selector) =>
    elements.get(selector);
  elements.get("#game-board").querySelector = (selector) => elements.get(selector);
  return {
    elements,
    document: {
      querySelector(selector) {
        return selector === missingSelector ? null : elements.get(selector);
      },
      createElement() {
        return new FakeHTMLElement();
      },
    },
  };
}

let importCounter = 0;

async function loadMain(fetchImpl, options = {}) {
  const original = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    HTMLElement: Object.getOwnPropertyDescriptor(globalThis, "HTMLElement"),
    HTMLButtonElement: Object.getOwnPropertyDescriptor(
      globalThis,
      "HTMLButtonElement",
    ),
    fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"),
  };
  const dom = createDocument(options);
  globalThis.document = dom.document;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.HTMLButtonElement = FakeHTMLButtonElement;
  globalThis.fetch = fetchImpl;

  try {
    const moduleUrl = new URL(
      `../src/main.js?integration=${++importCounter}`,
      import.meta.url,
    );
    const main = await import(moduleUrl.href);
    return { ...dom, authUI: main.authUI };
  } finally {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("main module automatically queries the exact same-origin session and renders authenticated DOM", async () => {
  let request;
  const app = await loadMain(async (url, options) => {
    request = { url, options };
    return response({
      authenticated: true,
      user: { displayName: "Synthetic Player" },
    });
  });

  assert.equal(request.url, "/api/auth/session");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.cache, "no-store");
  assert.equal(app.elements.get("#auth-status").textContent, "Bem-vindo, Synthetic Player.");
  assert.equal(app.elements.get("#auth-actions").hidden, true);
  assert.equal(app.elements.get("#logout-button").hidden, false);
  assert.equal(app.elements.get("#retry-session-button").hidden, true);
  assert.equal(app.elements.get(".auth-panel").attributes.get("aria-busy"), "false");
  assert.equal(app.elements.get("#multiplayer-panel").hidden, false);
});

test("main module renders an anonymous session without an error", async () => {
  const app = await loadMain(async () =>
    response({ authenticated: false, user: null }),
  );

  assert.equal(app.elements.get("#auth-status").textContent, "Você ainda não entrou.");
  assert.equal(app.elements.get("#auth-actions").hidden, false);
  assert.equal(app.elements.get("#logout-button").hidden, true);
  assert.equal(app.elements.get("#retry-session-button").hidden, true);
  assert.equal(app.elements.get("#multiplayer-panel").hidden, true);
});

test("main module handles HTTP, non-JSON, and network failures with retry controls", async () => {
  const failures = [
    async () => response({ error: "unavailable" }, 500),
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("synthetic non-JSON response");
      },
    }),
    async () => {
      throw new TypeError("synthetic network failure");
    },
  ];

  for (const fail of failures) {
    const app = await loadMain(fail);
    assert.equal(
      app.elements.get("#auth-status").textContent,
      "Não foi possível verificar a sessão. Tente novamente.",
    );
    assert.equal(app.elements.get("#auth-actions").hidden, false);
    assert.equal(app.elements.get("#retry-session-button").hidden, false);
  }
});

test("retry recovers after transient failure without discarding a previously valid session", async () => {
  let calls = 0;
  const app = await loadMain(async () => {
    calls += 1;
    if (calls === 1) {
      return response({
        authenticated: true,
        user: { displayName: "Synthetic Player" },
      });
    }
    if (calls === 2) {
      throw new TypeError("synthetic transient failure");
    }
    return response({ authenticated: false, user: null });
  });

  await app.authUI.refreshSession();
  assert.match(app.elements.get("#auth-status").textContent, /^Bem-vindo, Synthetic Player\./);
  assert.equal(app.elements.get("#auth-actions").hidden, true);
  assert.equal(app.elements.get("#logout-button").hidden, false);
  assert.equal(app.elements.get("#retry-session-button").hidden, false);

  await app.elements.get("#retry-session-button").click();
  assert.equal(app.elements.get("#auth-status").textContent, "Você ainda não entrou.");
  assert.equal(app.elements.get("#auth-actions").hidden, false);
  assert.equal(app.elements.get("#logout-button").hidden, true);
  assert.equal(app.elements.get("#retry-session-button").hidden, true);
});

test("stale concurrent session responses cannot overwrite the newest result", async () => {
  const stale = deferred();
  let calls = 0;
  const app = await loadMain(async () => {
    calls += 1;
    if (calls === 1) {
      return response({ authenticated: false, user: null });
    }
    if (calls === 2) {
      return stale.promise;
    }
    return response({
      authenticated: true,
      user: { displayName: "Current Player" },
    });
  });

  const olderRequest = app.authUI.refreshSession();
  await app.authUI.refreshSession();
  stale.resolve(response({ authenticated: false, user: null }));
  await olderRequest;

  assert.equal(app.elements.get("#auth-status").textContent, "Bem-vindo, Current Player.");
  assert.equal(app.elements.get("#auth-actions").hidden, true);
  assert.equal(app.elements.get("#logout-button").hidden, false);
});

test("logout revokes the visible session and returns to anonymous controls", async () => {
  let sessionRequests = 0;
  let logoutRequest;
  const app = await loadMain(async (url, options) => {
    if (url.endsWith("/auth/logout")) {
      logoutRequest = { url, options };
      return response({ authenticated: false });
    }
    sessionRequests += 1;
    return sessionRequests === 1
      ? response({
          authenticated: true,
          user: { displayName: "Synthetic Player" },
        })
      : response({ authenticated: false, user: null });
  });

  await app.elements.get("#logout-button").click();
  assert.equal(logoutRequest.url, "/api/auth/logout");
  assert.equal(logoutRequest.options.method, "POST");
  assert.equal(logoutRequest.options.credentials, "same-origin");
  assert.equal(app.elements.get("#auth-status").textContent, "Você ainda não entrou.");
  assert.equal(app.elements.get("#auth-actions").hidden, false);
  assert.equal(app.elements.get("#logout-button").hidden, true);
});

test("main entrypoint rejects an incomplete DOM instead of displaying a session error", async () => {
  await assert.rejects(
    loadMain(
      async () => response({ authenticated: false, user: null }),
      { missingSelector: "#auth-status" },
    ),
    /interface de autenticação não foram encontrados/,
  );
});
