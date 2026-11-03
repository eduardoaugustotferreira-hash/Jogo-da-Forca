import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  applyGuess,
  applyLeave,
  createWaitingRoom,
  resolveDisconnectExpiry,
  resolveTerminalBatch,
  setPaused,
  startRound,
} from "../worker/src/game-engine.js";
import { Room, snapshotFor } from "../worker/src/room.js";

const initialMigration = await readFile(
  new URL("../worker/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);
const wordMigration = await readFile(
  new URL("../worker/migrations/0002_word_entries.sql", import.meta.url),
  "utf8",
);

function word(id, displayWord, comparisonKey) {
  return {
    id,
    category: "geral",
    display_word: displayWord,
    comparison_key: comparisonKey,
    normalization_version: "test-normalization-v1",
    difficulty_version: "test-difficulty-v1",
    difficulty_score: 40,
    word_length: Array.from(comparisonKey).length,
    distinct_letter_count: new Set(comparisonKey).size,
    vowel_count: Array.from(comparisonKey).filter((letter) =>
      "aeiou".includes(letter),
    ).length,
    rarity_score: 0.4,
    validation_status: "validated",
  };
}

function roomState(pair = [word("one", "casa", "casa"), word("two", "cabo", "cabo")]) {
  const state = createWaitingRoom({
    code: "23456789ABCD",
    host: { userId: "user-1", displayName: "Player One", characterId: "knight" },
    createdAt: 0,
    expiresAt: 100_000,
  });
  state.players.push({
    userId: "user-2",
    displayName: "Player Two",
    characterId: "archer",
    seat: 2,
    connected: false,
    score: 0,
    word: null,
    guessedLetters: [],
    revealedIndices: [],
    lives: 6,
    terminal: null,
  });
  startRound(state, { playerOne: pair[0], playerTwo: pair[1] }, { tieBreakSeat: 2 });
  return state;
}

function submitLetters(state, userId, letters, prefix, now = 0) {
  let result;
  for (const [index, letter] of [...new Set(letters)].entries()) {
    result = applyGuess(
      state,
      userId,
      {
        eventId: `${prefix}-${index}-event`,
        payload: { letter },
      },
      now,
    );
  }
  return result;
}

test("round starts with different private words and six lives per player", () => {
  const state = roomState();

  assert.equal(state.phase, "playing");
  assert.notEqual(state.players[0].word.id, state.players[1].word.id);
  assert.deepEqual(state.players.map((player) => player.lives), [6, 6]);
});

test("correct guesses reveal all matching positions and accents compare consistently", () => {
  const state = roomState([
    word("one", "ação", "acao"),
    word("two", "cabo", "cabo"),
  ]);
  const result = applyGuess(
    state,
    "user-1",
    { eventId: "guess-accent-01", payload: { letter: "a" } },
    0,
  );

  assert.equal(result.status, "correct");
  assert.deepEqual(result.revealedIndices, [0, 2]);
  assert.equal(state.players[0].lives, 6);
});

test("incorrect guesses remove one life and duplicate letters do not remove another", () => {
  const state = roomState();
  const first = applyGuess(
    state,
    "user-1",
    { eventId: "wrong-guess-001", payload: { letter: "z" } },
    0,
  );
  const repeatedLetter = applyGuess(
    state,
    "user-1",
    { eventId: "wrong-guess-002", payload: { letter: "z" } },
    0,
  );

  assert.equal(first.status, "incorrect");
  assert.equal(first.lives, 5);
  assert.equal(repeatedLetter.status, "already_guessed");
  assert.equal(state.players[0].lives, 5);
});

test("replayed commands return their prior result without changing state", () => {
  const state = roomState();
  const command = {
    eventId: "replay-command-001",
    payload: { letter: "z" },
  };
  const first = applyGuess(state, "user-1", command, 0);
  const replay = applyGuess(state, "user-1", command, 10);

  assert.equal(replay.duplicate, true);
  assert.equal(replay.lives, first.lives);
  assert.equal(state.players[0].lives, 5);
});

test("malformed letters, unknown players, and malformed event IDs are rejected", () => {
  const state = roomState();
  assert.equal(
    applyGuess(
      state,
      "user-1",
      { eventId: "invalid-letter-01", payload: { letter: "1" } },
    ).status,
    "invalid_letter",
  );
  assert.equal(
    applyGuess(
      state,
      "outsider",
      { eventId: "unknown-player-01", payload: { letter: "a" } },
    ).status,
    "not_a_member",
  );
  assert.equal(
    applyGuess(
      state,
      "user-1",
      { eventId: "x", payload: { letter: "a" } },
    ).status,
    "invalid_event_id",
  );
});

test("six incorrect letters eliminate a player and award the round after adjudication", () => {
  const state = roomState();
  for (const [index, letter] of ["z", "x", "q", "w", "y", "v"].entries()) {
    applyGuess(
      state,
      "user-1",
      { eventId: `wrong-life-${index}-event`, payload: { letter } },
      index,
    );
  }
  assert.equal(state.players[0].lives, 0);
  assert.equal(state.players[0].terminal, "lost");
  const result = resolveTerminalBatch(state, 106);

  assert.equal(result.status, "round_completed");
  assert.equal(result.winnerUserId, "user-2");
  assert.deepEqual(state.players.map((player) => player.score), [0, 1]);
});

test("a completed word wins a normal round", () => {
  const state = roomState();
  submitLetters(state, "user-1", "casa", "solve");
  const result = resolveTerminalBatch(state, 100);

  assert.equal(result.status, "round_completed");
  assert.equal(result.winnerUserId, "user-1");
});

test("same-adjudication completion beats elimination, while double completion uses stored tie-break", () => {
  const state = roomState();
  submitLetters(state, "user-1", "casa", "winner");
  for (const [index, letter] of ["z", "x", "q", "w", "y", "v"].entries()) {
    applyGuess(
      state,
      "user-2",
      { eventId: `loss-${index}-event`, payload: { letter } },
      0,
    );
  }
  assert.equal(resolveTerminalBatch(state, 100).winnerUserId, "user-1");

  const double = roomState();
  submitLetters(double, "user-1", "casa", "double-one");
  submitLetters(double, "user-2", "cabo", "double-two");
  const result = resolveTerminalBatch(double, 100);
  assert.equal(result.winnerUserId, "user-2");
});

test("simultaneous double elimination draws without awarding a point", () => {
  const state = roomState();
  for (const [playerIndex, userId] of ["user-1", "user-2"].entries()) {
    for (const [index, letter] of ["z", "x", "q", "w", "y", "v"].entries()) {
      applyGuess(
        state,
        userId,
        {
          eventId: `double-loss-${playerIndex}-${index}-event`,
          payload: { letter },
        },
        0,
      );
    }
  }
  const result = resolveTerminalBatch(state, 100);

  assert.equal(result.status, "draw");
  assert.deepEqual(state.players.map((player) => player.score), [0, 0]);
});

test("best-of-five reaches 2-2 and enters a one-life deathmatch with one hint", () => {
  const state = roomState();
  const winners = ["user-1", "user-2", "user-1", "user-2"];
  let mode = "normal";
  for (const [round, winner] of winners.entries()) {
    const letters = winner === "user-1" ? "casa" : "cabo";
    submitLetters(state, winner, letters, `round-${round}`);
    const result = resolveTerminalBatch(state, 100);
    mode = result.nextMode;
    if (round < winners.length - 1) {
      startRound(
        state,
        {
          playerOne: word(`p1-${round}`, "casa", "casa"),
          playerTwo: word(`p2-${round}`, "cabo", "cabo"),
        },
        { mode, tieBreakSeat: 1 },
      );
    }
  }
  assert.deepEqual(state.players.map((player) => player.score), [2, 2]);
  assert.equal(mode, "deathmatch");
  startRound(
    state,
    {
      playerOne: word("death-one", "casa", "casa"),
      playerTwo: word("death-two", "cabo", "cabo"),
    },
    { mode, tieBreakSeat: 2 },
  );
  assert.deepEqual(state.players.map((player) => player.lives), [1, 1]);
  assert.equal(state.players.every((player) => player.revealedIndices.length === 1), true);

  for (const [playerIndex, userId] of ["user-1", "user-2"].entries()) {
    applyGuess(
      state,
      userId,
      {
        eventId: `deathmatch-elimination-${playerIndex}`,
        payload: { letter: "z" },
      },
      0,
    );
  }
  assert.equal(resolveTerminalBatch(state, 100).winnerUserId, "user-2");
  assert.equal(state.phase, "completed");
});

test("a voluntary leave is idempotent and awards abandonment to the opponent", () => {
  const state = roomState();
  const result = applyLeave(state, "user-1", "leave-room-command-01");
  const replay = applyLeave(state, "user-1", "leave-room-command-01");

  assert.equal(result.winnerUserId, "user-2");
  assert.equal(replay.duplicate, true);
  assert.equal(state.endReason, "voluntary_abandonment");
});

test("disconnect pauses the room, reconnect can restore it, and expiry adjudicates abandonment", () => {
  const state = roomState();
  state.players[0].connected = true;
  state.players[1].connected = false;
  setPaused(state, 1_000);
  assert.equal(state.phase, "paused");
  assert.equal(resolveDisconnectExpiry(state, 60_999).status, "not_ready");

  state.players[1].connected = true;
  state.phase = state.pausedPhase;
  state.pausedPhase = null;
  state.disconnectDeadlineAt = null;
  assert.equal(resolveDisconnectExpiry(state, 70_000).status, "not_ready");

  setPaused(state, 80_000);
  state.players[0].connected = false;
  assert.equal(resolveDisconnectExpiry(state, 140_000).winnerUserId, "user-2");
  assert.equal(state.endReason, "abandonment");
});

test("room snapshots mask the opponent answer and reveal it only after the match", () => {
  const state = roomState();
  const hostSnapshot = snapshotFor(state, "user-1");
  const guestSnapshot = snapshotFor(state, "user-2");

  assert.equal(hostSnapshot.players[0].word.masked, "_ _ _ _");
  assert.equal(hostSnapshot.players[1].word, undefined);
  assert.equal(JSON.stringify(hostSnapshot).includes("cabo"), false);
  assert.equal(guestSnapshot.players[1].word.masked, "_ _ _ _");
  state.phase = "completed";
  assert.equal(snapshotFor(state, "user-1").players[1].answer, "cabo");
});

class MockStorage {
  values = new Map();
  alarm = null;
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async setAlarm(time) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}

function testDatabase(entries) {
  return {
    prepare() {
      return {
        bind() { return this; },
        all: async () => ({ results: entries }),
      };
    },
    async batch() { return []; },
  };
}

function sqliteD1(entries) {
  const database = new DatabaseSync(":memory:");
  database.exec(initialMigration);
  database.exec(wordMigration);
  for (const [userId, displayName] of [
    ["user-1", "Player One"],
    ["user-2", "Player Two"],
  ]) {
    database
      .prepare("INSERT INTO users (id, display_name) VALUES (?, ?)")
      .run(userId, displayName);
  }
  return {
    prepare(sql) {
      let parameters = [];
      return {
        sql,
        get parameters() { return parameters; },
        bind(...values) {
          parameters = values;
          return this;
        },
        all() {
          return sql.includes("FROM word_entries")
            ? { results: entries }
            : { results: database.prepare(sql).all(...parameters) };
        },
        run() {
          return database.prepare(sql).run(...parameters);
        },
        first() {
          return database.prepare(sql).get(...parameters) ?? null;
        },
      };
    },
    batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          database
            .prepare(statement.sql)
            .run(...statement.parameters),
        );
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      database.close();
    },
    database,
  };
}

test("Durable Object room creation and joining start only with a valid word pair", async () => {
  const storage = new MockStorage();
  const room = new Room({ storage }, {
    DB: testDatabase([
      word("one", "casa", "casa"),
      word("two", "cabo", "cabo"),
    ]),
  });
  const created = await room.fetch(
    new Request("https://room.internal/_internal/create?code=23456789ABCD", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-1", displayName: "Player One" },
        characterId: "knight",
      }),
    }),
  );
  const joined = await room.fetch(
    new Request("https://room.internal/_internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-2", displayName: "Player Two" },
        characterId: "archer",
      }),
    }),
  );
  const state = await joined.json();

  assert.equal(created.status, 201);
  assert.equal(joined.status, 200);
  assert.equal(state.phase, "playing");
  assert.equal(state.players.length, 2);
});

test("room membership prevents duplicate seats and rejects a third player", async () => {
  const room = new Room(
    { storage: new MockStorage() },
    {
      DB: testDatabase([
        word("one", "casa", "casa"),
        word("two", "cabo", "cabo"),
      ]),
    },
  );
  const createRequest = (id) =>
    new Request("https://room.internal/_internal/create?code=23456789ABCD", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id, displayName: `Player ${id}` },
        characterId: "knight",
      }),
    });
  const joinRequest = (id) =>
    new Request("https://room.internal/_internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id, displayName: `Player ${id}` },
        characterId: "archer",
      }),
    });

  await room.fetch(createRequest("user-1"));
  await room.fetch(joinRequest("user-1"));
  assert.equal((await room.readState()).players.length, 1);
  await room.fetch(joinRequest("user-2"));
  const third = await room.fetch(joinRequest("user-3"));

  assert.equal(third.status, 409);
  assert.equal((await room.readState()).players.length, 2);
});

test("Durable Object fails closed when there is no validated equivalent word pair", async () => {
  const storage = new MockStorage();
  const room = new Room({ storage }, { DB: testDatabase([]) });
  await room.fetch(
    new Request("https://room.internal/_internal/create?code=23456789ABCD", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-1", displayName: "Player One" },
        characterId: "knight",
      }),
    }),
  );
  const response = await room.fetch(
    new Request("https://room.internal/_internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-2", displayName: "Player Two" },
        characterId: "archer",
      }),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "word_pool_unavailable");
  assert.equal((await storage.get("room")).players.length, 1);
});

test("Durable Object rotates a completed Deathmatch word to an unused equivalent", async () => {
  const entries = [
    word("one", "casa", "casa"),
    word("two", "cabo", "cabo"),
    word("three", "cama", "cama"),
  ];
  const state = roomState(entries.slice(0, 2));
  state.roundMode = "deathmatch";
  const room = new Room({ storage: new MockStorage() }, { DB: testDatabase(entries) });
  const next = await room.selectWordFor(state.players[0].word, state);

  assert.equal(next.id, "three");
});

test("Deathmatch cancels explicitly when its unused equivalent word pool is exhausted", async () => {
  const entries = [word("one", "casa", "casa"), word("two", "cabo", "cabo")];
  const storage = new MockStorage();
  const room = new Room({ storage }, { DB: testDatabase(entries) });
  await room.fetch(
    new Request("https://room.internal/_internal/create?code=23456789ABCD", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-1", displayName: "Player One" },
        characterId: "knight",
      }),
    }),
  );
  await room.fetch(
    new Request("https://room.internal/_internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-2", displayName: "Player Two" },
        characterId: "archer",
      }),
    }),
  );
  const state = await storage.get("room");
  state.roundMode = "deathmatch";
  state.players[0].revealedIndices = [];
  await room.writeState(state);
  const socket = { send() {} };
  room.sockets.set("user-1", socket);
  for (const [index, letter] of [
    ...new Set(Array.from(state.players[0].word.comparisonKey)),
  ].entries()) {
    await room.onMessage(
      "user-1",
      socket,
      JSON.stringify({
        version: 1,
        type: "round.guess",
        eventId: `exhausted-pool-${index}-event`,
        payload: { letter },
      }),
    );
  }
  const result = await storage.get("room");

  assert.equal(result.phase, "cancelled");
  assert.equal(result.endReason, "word_pool_unavailable");
});

test("Durable Object serializes and deduplicates socket commands and rejects stale sockets", async () => {
  const storage = new MockStorage();
  const room = new Room(
    { storage },
    {
      DB: testDatabase([
        word("one", "casa", "casa"),
        word("two", "cabo", "cabo"),
      ]),
    },
  );
  await room.fetch(
    new Request("https://room.internal/_internal/create?code=23456789ABCD", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-1", displayName: "Player One" },
        characterId: "knight",
      }),
    }),
  );
  await room.fetch(
    new Request("https://room.internal/_internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-2", displayName: "Player Two" },
        characterId: "archer",
      }),
    }),
  );
  const currentSocket = { send() {} };
  const staleSocket = { send() {} };
  room.sockets.set("user-1", currentSocket);
  const command = JSON.stringify({
    version: 1,
    type: "round.guess",
    eventId: "socket-command-0001",
    payload: { letter: "z" },
  });

  await room.onMessage("user-1", staleSocket, command);
  assert.equal((await storage.get("room")).players[0].lives, 6);
  await room.onMessage("user-1", currentSocket, command);
  await room.onMessage("user-1", currentSocket, command);
  assert.equal((await storage.get("room")).players[0].lives, 5);
});

test("match lifecycle persists match players and idempotent final statistics to D1 schema", async () => {
  const db = sqliteD1([word("one", "casa", "casa"), word("two", "cabo", "cabo")]);
  const storage = new MockStorage();
  const room = new Room({ storage }, { DB: db });
  try {
    await room.fetch(
      new Request("https://room.internal/_internal/create?code=23456789ABCD", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: { id: "user-1", displayName: "Player One" },
          characterId: "knight",
        }),
      }),
    );
    await room.fetch(
      new Request("https://room.internal/_internal/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: { id: "user-2", displayName: "Player Two" },
          characterId: "archer",
        }),
      }),
    );
    const state = await storage.get("room");
    state.players[0].score = 2;
    state.players[1].score = 1;
    await room.persistScores(state);
    const socket = { send() {} };
    room.sockets.set("user-1", socket);
    await room.onMessage(
      "user-1",
      socket,
      JSON.stringify({
        version: 1,
        type: "room.leave",
        eventId: "persist-leave-event-01",
      }),
    );
    const finishedState = await storage.get("room");
    finishedState.matchFinalized = false;
    await room.persistMatchFinished(finishedState);
    const match = db.database
      .prepare("SELECT status, winner_user_id FROM matches WHERE id = ?")
      .get(state.matchId);
    const stats = db.database
      .prepare(
        "SELECT user_id, matches_played, matches_won, matches_lost FROM player_stats ORDER BY user_id",
      )
      .all()
      .map((row) => ({ ...row }));
    const matchPlayers = db.database
      .prepare("SELECT seat, rounds_won FROM match_players WHERE match_id = ? ORDER BY seat")
      .all(state.matchId)
      .map((row) => ({ ...row }));

    assert.equal(match.status, "abandoned");
    assert.equal(match.winner_user_id, "user-2");
    assert.deepEqual(stats, [
      { user_id: "user-1", matches_played: 1, matches_won: 0, matches_lost: 1 },
      { user_id: "user-2", matches_played: 1, matches_won: 1, matches_lost: 0 },
    ]);
    assert.deepEqual(matchPlayers, [
      { seat: 1, rounds_won: 2 },
      { seat: 2, rounds_won: 1 },
    ]);
  } finally {
    db.close();
  }
});

test("two authenticated room actors can complete 2-2 rounds and win Deathmatch through the DO handler", async () => {
  const entries = [
    "casa", "cabo", "cama", "cana", "capa", "cata", "cava",
    "cala", "cara", "bala", "mala", "fada", "faca", "lava",
  ].map((value, index) => word(`fixture-${index}`, value, value));
  let now = 1_000;
  const storage = new MockStorage();
  const room = new Room(
    { storage },
    { DB: testDatabase(entries), CLOCK: { now: () => now } },
  );
  await room.fetch(
    new Request("https://room.internal/_internal/create?code=23456789ABCD", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-1", displayName: "Player One" },
        characterId: "knight",
      }),
    }),
  );
  await room.fetch(
    new Request("https://room.internal/_internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { id: "user-2", displayName: "Player Two" },
        characterId: "archer",
      }),
    }),
  );
  const sockets = new Map([
    ["user-1", { send() {} }],
    ["user-2", { send() {} }],
  ]);
  for (const [userId, socket] of sockets) room.sockets.set(userId, socket);
  let commandNumber = 0;
  const guess = async (userId, letter) => {
    const command = JSON.stringify({
      version: 1,
      type: "round.guess",
      eventId: `full-match-${commandNumber++}-event`,
      payload: { letter },
    });
    await room.onMessage(
      userId,
      sockets.get(userId),
      command,
    );
    return command;
  };
  const solve = async (userId) => {
    const state = await storage.get("room");
    const player = state.players.find((item) => item.userId === userId);
    let lastCommand;
    for (const letter of new Set(Array.from(player.word.comparisonKey))) {
      lastCommand = await guess(userId, letter);
    }
    const terminalState = await storage.get("room");
    if (terminalState.terminalDeadlineAt) {
      now = terminalState.terminalDeadlineAt;
      await room.alarm();
    }
    return lastCommand;
  };

  for (const winner of ["user-1", "user-2", "user-1", "user-2"]) {
    await solve(winner);
  }
  let state = await storage.get("room");
  assert.deepEqual(state.players.map((player) => player.score), [2, 2]);
  assert.equal(state.roundMode, "deathmatch");
  assert.equal(state.players.every((player) => player.lives === 1), true);
  assert.equal(state.players.every((player) => player.revealedIndices.length === 1), true);

  const beforeRotation = state.players[0].word.id;
  const completedCommand = await solve("user-1");
  state = await storage.get("room");
  assert.notEqual(state.players[0].word.id, beforeRotation);
  assert.equal(state.players[0].lives, 1);
  assert.equal(state.roundMode, "deathmatch");
  const rotatedWordId = state.players[0].word.id;
  await room.onMessage("user-1", sockets.get("user-1"), completedCommand);
  assert.equal((await storage.get("room")).players[0].word.id, rotatedWordId);

  await guess("user-2", "z");
  state = await storage.get("room");
  now = state.terminalDeadlineAt;
  await room.alarm();
  state = await storage.get("room");
  assert.equal(state.phase, "completed");
  assert.equal(state.winnerUserId, "user-1");
  assert.equal(state.endReason, "deathmatch_elimination");
});

test("room API requires a server-resolved authenticated session", async () => {
  const worker = await import("../worker/src/index.js");
  const response = await worker.default.fetch(
    new Request("http://localhost:8788/v1/rooms", {
      method: "POST",
      headers: {
        Origin: "http://localhost:8788",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ characterId: "knight" }),
    }),
    {
      PUBLIC_ORIGIN: "http://localhost:8788",
      APP_ENV: "local",
      ROOMS: { idFromName: () => "unused", get: () => ({ fetch() {} }) },
    },
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("room creation derives player identity from the authenticated D1 session", async () => {
  const sessionId = "synthetic-session-for-room-test";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sessionId),
  );
  const sessionHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let roomRequest;
  const response = await (await import("../worker/src/index.js")).default.fetch(
    new Request("http://localhost:8788/v1/rooms", {
      method: "POST",
      headers: {
        Origin: "http://localhost:8788",
        "Content-Type": "application/json",
        Cookie: `__Host-afm_session=${sessionId}`,
      },
      body: JSON.stringify({
        userId: "forged-user-id",
        characterId: "knight",
      }),
    }),
    {
      PUBLIC_ORIGIN: "http://localhost:8788",
      APP_ENV: "local",
      DB: {
        prepare() {
          return {
            bind(hash) {
              assert.equal(hash, sessionHash);
              return {
                async first() {
                  return { id: "server-user-id", display_name: "Server User" };
                },
              };
            },
          };
        },
      },
      ROOMS: {
        idFromName(code) {
          assert.match(code, /^[A-Z2-9]{16}$/);
          return code;
        },
        get() {
          return {
            async fetch(request) {
              roomRequest = request;
              return Response.json({ code: new URL(request.url).searchParams.get("code") }, { status: 201 });
            },
          };
        },
      },
    },
  );
  const body = await (await roomRequest.json());

  assert.equal(response.status, 201);
  assert.equal(body.user.id, "server-user-id");
  assert.equal(body.user.displayName, "Server User");
  assert.equal("userId" in body, false);
});

test("authenticated WebSocket upgrade forwards only the server-resolved actor", async () => {
  const sessionId = "synthetic-websocket-session";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sessionId),
  );
  const sessionHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let roomRequest;
  const response = await (await import("../worker/src/index.js")).default.fetch(
    new Request("http://localhost:8788/v1/rooms/23456789ABCDEFGH/ws", {
      headers: {
        Origin: "http://localhost:8788",
        Upgrade: "websocket",
        Connection: "Upgrade",
        Cookie: `__Host-afm_session=${sessionId}`,
      },
    }),
    {
      PUBLIC_ORIGIN: "http://localhost:8788",
      APP_ENV: "local",
      DB: {
        prepare() {
          return {
            bind(hash) {
              assert.equal(hash, sessionHash);
              return {
                async first() {
                  return { id: "verified-actor", display_name: "Player" };
                },
              };
            },
          };
        },
      },
      ROOMS: {
        idFromName: (code) => code,
        get: () => ({
          async fetch(request) {
            roomRequest = request;
            return new Response("mock websocket forwarded");
          },
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(new URL(roomRequest.url).pathname, "/v1/rooms/23456789ABCDEFGH/ws");
  assert.equal(roomRequest.headers.get("Upgrade"), "websocket");
  assert.equal(roomRequest.headers.get("Origin"), "http://localhost:8788");
  assert.equal(roomRequest.headers.get("x-room-user-id"), "verified-actor");
  assert.equal(roomRequest.headers.get("Cookie"), null);
});
