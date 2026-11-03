import {
  applyLeave,
  applyGuess,
  createWaitingRoom,
  resolveDisconnectExpiry,
  resolveTerminalBatch,
  setPaused,
  startRound,
  validCharacter,
} from "./game-engine.js";
import {
  selectWordPair,
  selectWordForReference,
} from "./word-bank.js";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_BYTES = 2_048;
const MAX_MESSAGES_PER_WINDOW = 30;
const MESSAGE_WINDOW_MS = 10_000;

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clock =
      typeof env?.CLOCK?.now === "function"
        ? env.CLOCK
        : { now: () => Date.now() };
    this.sockets = new Map();
    this.messageTimes = new Map();
    this.serialized = Promise.resolve();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/_internal/create") {
      return this.enqueue(() => this.create(request));
    }
    if (request.method === "POST" && url.pathname === "/_internal/join") {
      return this.join(request);
    }
    if (request.method === "GET" && url.pathname === "/_internal/snapshot") {
      const state = await this.readState();
      const userId = request.headers.get("x-room-user-id");
      if (!state || !state.players.some((player) => player.userId === userId)) {
        return json({ error: "room_not_found" }, 404);
      }
      return json(snapshotFor(state, userId));
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/_internal/socket" ||
        /^\/v1\/rooms\/[A-Z2-9]{16}\/ws$/.test(url.pathname))
    ) {
      return this.enqueue(() => this.connect(request));
    }
    return json({ error: "not_found" }, 404);
  }

  async alarm() {
    return this.enqueue(async () => {
      const state = await this.readState();
      if (!state) return;
      const now = this.clock.now();
      if (state.terminalDeadlineAt && now >= state.terminalDeadlineAt) {
        const result = resolveTerminalBatch(state, now);
        if (
          result.status === "round_completed" ||
          result.status === "match_completed"
        ) {
          state.lastRoundResult = result;
          await this.persistScores(state);
          if (result.status === "round_completed") {
            await this.advanceRound(state, result.nextMode);
          }
        } else if (result.status === "draw") {
          state.lastRoundResult = result;
          await this.advanceRound(state, "normal");
        }
      } else if (
        state.phase === "paused" &&
        state.disconnectDeadlineAt &&
        now >= state.disconnectDeadlineAt
      ) {
        resolveDisconnectExpiry(state, now);
      } else if (state.phase === "waiting" && now >= state.expiresAt) {
        state.phase = "cancelled";
        state.endReason = "room_expired";
      } else {
        return;
      }
      await this.persistMatchFinished(state);
      await this.writeState(state);
      this.broadcast(state);
      await this.scheduleNextAlarm(state);
    });
  }

  async create(request) {
    const body = await readJson(request);
    if (!body || !validIdentity(body.user) || !validCharacter(body.characterId)) {
      return json({ error: "invalid_request" }, 400);
    }
    const current = await this.readState();
    if (current) return json({ error: "room_already_exists" }, 409);

    const now = this.clock.now();
    const state = createWaitingRoom({
      code: new URL(request.url).searchParams.get("code"),
      host: {
        userId: body.user.id,
        displayName: body.user.displayName,
        characterId: body.characterId,
      },
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
    });
    await this.writeState(state);
    await this.scheduleNextAlarm(state);
    return json(snapshotFor(state, body.user.id), 201);
  }

  async join(request) {
    const body = await readJson(request);
    if (!body || !validIdentity(body.user) || !validCharacter(body.characterId)) {
      return json({ error: "invalid_request" }, 400);
    }
    return this.enqueue(async () => {
      const state = await this.readState();
      if (!state || ["cancelled", "completed"].includes(state.phase)) {
        return json({ error: "room_not_found" }, 404);
      }
      const existing = state.players.find(
        (player) => player.userId === body.user.id,
      );
      if (existing) {
        return json(snapshotFor(state, body.user.id));
      }
      if (
        state.phase !== "waiting" ||
        state.players.length >= 2 ||
        this.clock.now() >= state.expiresAt
      ) {
        return json({ error: "room_full_or_unavailable" }, 409);
      }

      const candidate = structuredClone(state);
      candidate.players.push({
        userId: body.user.id,
        displayName: body.user.displayName,
        characterId: body.characterId,
        seat: 2,
        connected: false,
        score: 0,
        word: null,
        guessedLetters: [],
        guessResults: {},
        revealedIndices: [],
        lives: 6,
        terminal: null,
      });
      const pair = await this.selectPair(candidate);
      if (!pair) {
        return json({ error: "word_pool_unavailable" }, 503);
      }
      try {
        startRound(candidate, pair, {
          mode: "normal",
          tieBreakSeat: secureRandomIndex(2) + 1,
        });
      } catch (error) {
        if (error instanceof TypeError) {
          return json({ error: "word_pair_unavailable" }, 503);
        }
        throw error;
      }
      await this.persistMatchStarted(candidate);
      await this.writeState(candidate);
      await this.scheduleNextAlarm(candidate);
      return json(snapshotFor(candidate, body.user.id), 200);
    });
  }

  async connect(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_required" }, 426);
    }
    const userId = request.headers.get("x-room-user-id");
    const state = await this.readState();
    const player = state?.players.find((item) => item.userId === userId);
    if (!state || !player || ["cancelled", "completed"].includes(state.phase)) {
      return json({ error: "room_not_found" }, 404);
    }
    const Pair = globalThis.WebSocketPair;
    if (!Pair) return json({ error: "websocket_unavailable" }, 503);
    const pair = new Pair();
    const [client, server] = Object.values(pair);
    server.accept();
    const previousSocket = this.sockets.get(userId);
    this.sockets.set(userId, server);
    if (previousSocket && previousSocket !== server) previousSocket.close(4001, "reconnected");
    player.connected = true;
    if (
      state.phase === "paused" &&
      state.players.every((item) => item.connected)
    ) {
      state.phase = state.pausedPhase ?? "playing";
      state.pausedPhase = null;
      state.disconnectDeadlineAt = null;
    }
    await this.writeState(state);
    await this.scheduleNextAlarm(state);
    server.addEventListener("message", (event) => {
      this.enqueue(() => this.onMessage(userId, server, event.data)).catch(() => {
        this.send(server, { type: "error", code: "room_operation_failed" });
      });
    });
    server.addEventListener("close", () => {
      this.enqueue(() => this.onClose(userId, server)).catch(() => {
        this.send(server, { type: "error", code: "room_operation_failed" });
      });
    });
    server.addEventListener("error", () => {
      this.enqueue(() => this.onClose(userId, server)).catch(() => {
        this.send(server, { type: "error", code: "room_operation_failed" });
      });
    });
    this.send(server, { type: "room.snapshot", state: snapshotFor(state, userId) });
    this.broadcast(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(userId, sourceSocket, raw) {
    const socket = this.sockets.get(userId);
    if (!socket || socket !== sourceSocket) return;
    if (!this.allowMessage(userId, raw)) {
      this.send(socket, { type: "error", code: "rate_or_size_limit" });
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.send(socket, { type: "error", code: "invalid_json" });
      return;
    }
    if (!message || typeof message !== "object" || message.version !== 1) {
      this.send(socket, { type: "error", code: "invalid_message" });
      return;
    }
    const state = await this.readState();
    if (!state) return;
    if (message.type === "room.leave") {
      const result = applyLeave(state, userId, message.eventId);
      await this.persistMatchFinished(state);
      await this.writeState(state);
      this.send(socket, {
        type: "room.action",
        result: {
          status: result.status,
          sequence: result.sequence,
          duplicate: result.duplicate ?? false,
        },
      });
      this.broadcast(state);
      return;
    }
    if (message.type !== "round.guess") {
      this.send(socket, { type: "error", code: "invalid_message" });
      return;
    }
    if (
      state.terminalDeadlineAt &&
      this.clock.now() >= state.terminalDeadlineAt
    ) {
      const result = resolveTerminalBatch(state, this.clock.now());
      if (
        result.status === "round_completed" ||
        result.status === "match_completed"
      ) {
        state.lastRoundResult = result;
        await this.persistScores(state);
        if (result.status === "round_completed") {
          await this.advanceRound(state, result.nextMode);
        }
      } else if (result.status === "draw") {
        state.lastRoundResult = result;
        await this.advanceRound(state, "normal");
      }
      await this.persistMatchFinished(state);
      await this.writeState(state);
      this.broadcast(state);
      await this.scheduleNextAlarm(state);
      this.send(socket, {
        type: "round.action",
        result: { status: "round_closed" },
      });
      return;
    }
    const result = applyGuess(
      state,
      userId,
      { eventId: message.eventId, payload: message.payload },
      this.clock.now(),
    );
    if (result.needsDeathmatchWord && !result.duplicate) {
      const player = state.players.find((item) => item.userId === userId);
      const next = await this.selectWordFor(player.word, state);
      if (!next) {
        state.phase = "cancelled";
        state.endReason = "word_pool_unavailable";
      } else {
        player.word = toStoredWord(next);
        state.usedWordIds.push(next.id);
        const letters = Array.from(next.comparison_key);
        player.revealedIndices = [secureRandomIndex(letters.length)];
        player.guessedLetters = [];
        player.guessResults = {};
        player.lives = 1;
      }
    }
    await this.persistMatchFinished(state);
    if (result.terminal && !result.duplicate) {
      state.terminalDeadlineAt ??= this.clock.now() + 100;
      await this.state.storage.setAlarm(state.terminalDeadlineAt);
    }
    await this.writeState(state);
    this.send(socket, { type: "round.action", result });
    this.broadcast(state);
    await this.scheduleNextAlarm(state);
  }

  async onClose(userId, socket) {
    if (this.sockets.get(userId) !== socket) return;
    this.sockets.delete(userId);
    const state = await this.readState();
    if (!state) return;
    const player = state.players.find((item) => item.userId === userId);
    if (!player) return;
    player.connected = false;
    if (state.players.some((item) => !item.connected)) {
      setPaused(state, this.clock.now());
    }
    await this.writeState(state);
    await this.scheduleNextAlarm(state);
    this.broadcast(state);
  }

  async advanceRound(state, mode) {
    if (state.phase === "completed" || state.phase === "cancelled") return;
    const pair = await this.selectPair(state);
    if (!pair) {
      state.phase = "cancelled";
      state.endReason = "word_pool_unavailable";
      return;
    }
    startRound(state, pair, {
      mode,
      tieBreakSeat: secureRandomIndex(2) + 1,
    });
  }

  async persistMatchStarted(state) {
    const db = this.env?.DB;
    if (!db || typeof db.batch !== "function") {
      throw new Error("D1 batch support is required to persist a match.");
    }
    const statements = [
      db
        .prepare(
          "INSERT INTO matches (id, status, started_at) VALUES (?, 'in_progress', ?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(state.matchId, new Date().toISOString()),
      ...state.players.map((player) =>
        db
          .prepare(
            "INSERT INTO match_players (match_id, user_id, seat, character_id) VALUES (?, ?, ?, ?) ON CONFLICT(match_id, user_id) DO NOTHING",
          )
          .bind(
            state.matchId,
            player.userId,
            player.seat,
            player.characterId,
          ),
      ),
    ];
    await db.batch(statements);
    state.matchPersisted = true;
  }

  async persistScores(state) {
    if (!state.matchPersisted) return;
    await this.env.DB.batch(
      state.players.map((player) =>
        this.env.DB
          .prepare(
            "UPDATE match_players SET rounds_won = ? WHERE match_id = ? AND seat = ?",
          )
          .bind(player.score, state.matchId, player.seat),
      ),
    );
  }

  async persistMatchFinished(state) {
    if (
      !state.matchPersisted ||
      state.matchFinalized ||
      !["completed", "cancelled"].includes(state.phase)
    ) {
      return;
    }
    const status =
      state.phase === "cancelled"
        ? "cancelled"
        : ["abandonment", "voluntary_abandonment"].includes(state.endReason)
          ? "abandoned"
          : "completed";
    const winnerUserId = state.winnerUserId;
    await this.env.DB.batch([
      this.env.DB
        .prepare(
          "UPDATE matches SET status = ?, winner_user_id = ?, ended_at = ? WHERE id = ? AND status = 'in_progress'",
        )
        .bind(status, winnerUserId, new Date().toISOString(), state.matchId),
      this.env.DB
        .prepare(
          `INSERT INTO player_stats (
             user_id, matches_played, matches_won, matches_lost, updated_at
           )
           SELECT match_players.user_id, 1,
                  CASE WHEN ? IS NOT NULL AND match_players.user_id = ? THEN 1 ELSE 0 END,
                  CASE WHEN ? IS NOT NULL AND match_players.user_id <> ? THEN 1 ELSE 0 END,
                  ?
           FROM match_players
           WHERE match_players.match_id = ?
             AND changes() = 1
             AND ? != 'cancelled'
           ON CONFLICT(user_id) DO UPDATE SET
             matches_played = player_stats.matches_played + excluded.matches_played,
             matches_won = player_stats.matches_won + excluded.matches_won,
             matches_lost = player_stats.matches_lost + excluded.matches_lost,
             updated_at = excluded.updated_at`,
        )
        .bind(
          winnerUserId,
          winnerUserId,
          winnerUserId,
          winnerUserId,
          new Date().toISOString(),
          state.matchId,
          status,
        ),
    ]);
    state.matchFinalized = true;
  }

  async selectPair(state) {
    const db = this.env?.DB;
    if (!db) return null;
    const result = await db
      .prepare(
        `SELECT id, category, display_word, comparison_key,
                normalization_version, difficulty_version, difficulty_score,
                word_length, distinct_letter_count, vowel_count, rarity_score,
                validation_status
         FROM word_entries
         WHERE validation_status = 'validated'
         ORDER BY id`,
      )
      .all();
    const entries = result?.results ?? [];
    const categories = [...new Set(entries.map((entry) => entry.category))];
    shuffle(categories);
    for (const category of categories) {
      const selection = selectWordPair(entries, {
        category,
        usedWordIds: state.usedWordIds,
      });
      if (selection.status === "selected") {
        return {
          playerOne: selection.playerOne,
          playerTwo: selection.playerTwo,
        };
      }
    }
    return null;
  }

  async selectWordFor(reference, state) {
    const db = this.env?.DB;
    if (!db) return null;
    const result = await db
      .prepare(
        `SELECT id, category, display_word, comparison_key,
                normalization_version, difficulty_version, difficulty_score,
                word_length, distinct_letter_count, vowel_count, rarity_score,
                validation_status
         FROM word_entries
         WHERE validation_status = 'validated'
         ORDER BY id`,
      )
      .all();
    const selection = selectWordForReference(
      result?.results ?? [],
      {
        normalization_version: reference.normalizationVersion,
        difficulty_version: reference.difficultyVersion,
        difficulty_score: reference.difficultyScore,
        word_length: reference.wordLength,
        distinct_letter_count: reference.distinctLetterCount,
        vowel_count: reference.vowelCount,
        rarity_score: reference.rarityScore,
      },
      {
        category: reference.category,
        usedWordIds: state.usedWordIds,
      },
    );
    return selection.status === "selected" ? selection.word : null;
  }

  allowMessage(userId, raw) {
    const now = this.clock.now();
    const recent = (this.messageTimes.get(userId) ?? []).filter(
      (time) => now - time < MESSAGE_WINDOW_MS,
    );
    if (recent.length >= MAX_MESSAGES_PER_WINDOW) return false;
    recent.push(now);
    this.messageTimes.set(userId, recent);
    return (
      typeof raw === "string" &&
      new TextEncoder().encode(raw).byteLength <= MAX_MESSAGE_BYTES
    );
  }

  async readState() {
    return (await this.state.storage.get("room")) ?? null;
  }

  async writeState(state) {
    await this.state.storage.put("room", state);
  }

  async scheduleNextAlarm(state) {
    const deadline =
      state.phase === "paused"
        ? state.disconnectDeadlineAt
        : state.terminalDeadlineAt ??
          (state.phase === "waiting" ? state.expiresAt : null);
    if (deadline) await this.state.storage.setAlarm(deadline);
    else await this.state.storage.deleteAlarm();
  }

  broadcast(state) {
    for (const [userId, socket] of this.sockets) {
      this.send(socket, {
        type: "room.snapshot",
        state: snapshotFor(state, userId),
      });
    }
  }

  send(socket, value) {
    try {
      socket.send(JSON.stringify(value));
    } catch {
      return;
    }
  }

  enqueue(operation) {
    const next = this.serialized.then(operation, operation);
    this.serialized = next.catch(() => {});
    return next;
  }
}

export function snapshotFor(state, userId) {
  const own = state.players.find((player) => player.userId === userId);
  if (!own) return null;
  const opponent = state.players.find((player) => player !== own);
  const mask = (player) => {
    if (!player.word) return null;
    const characters = Array.from(player.word.displayWord);
    return characters
      .map((character, index) =>
        player.revealedIndices.includes(index) ? character : "_",
      )
      .join(" ");
  };
  const revealAnswers = ["completed", "cancelled"].includes(state.phase);
  return {
    version: state.version,
    code: state.code,
    phase: state.phase,
    roundNumber: state.roundNumber,
    roundMode: state.roundMode,
    players: state.players.map((player) => ({
      isYou: player.userId === userId,
      isWinner: state.winnerUserId === player.userId,
      displayName: player.displayName,
      characterId: player.characterId,
      seat: player.seat,
      connected: player.connected,
      score: player.score,
      lives: player.userId === userId ? player.lives : undefined,
      word:
        player.userId === userId
          ? {
              masked: mask(player),
              lives: player.lives,
              guessedLetters: [...player.guessedLetters],
              guessResults: { ...player.guessResults },
              revealedCount: player.revealedIndices.length,
              length: player.word?.wordLength ?? 0,
            }
          : undefined,
      progress: player.word
        ? player.revealedIndices.length / player.word.wordLength
        : 0,
      answer:
        revealAnswers && player.word ? player.word.displayWord : undefined,
    })),
    winnerDisplayName:
      state.winnerUserId === null
        ? null
        : state.players.find((player) => player.userId === state.winnerUserId)
            ?.displayName ?? null,
    endReason: state.endReason,
    lastRoundResult: state.lastRoundResult
      ? {
          status: state.lastRoundResult.status,
          scores: state.lastRoundResult.scores,
          nextMode: state.lastRoundResult.nextMode,
          reason: state.lastRoundResult.reason,
        }
      : null,
  };
}

function toStoredWord(word) {
  return {
    id: word.id,
    category: word.category,
    displayWord: word.display_word,
    comparisonKey: word.comparison_key,
    normalizationVersion: word.normalization_version,
    difficultyVersion: word.difficulty_version,
    difficultyScore: word.difficulty_score,
    wordLength: word.word_length,
    distinctLetterCount: word.distinct_letter_count,
    vowelCount: word.vowel_count,
    rarityScore: word.rarity_score,
  };
}

function validIdentity(user) {
  return (
    user &&
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.displayName === "string" &&
    user.displayName.length > 0 &&
    user.displayName.length <= 80
  );
}

function readJson(request) {
  return request.json().catch(() => null);
}

function secureRandomIndex(length) {
  if (!Number.isInteger(length) || length < 1) throw new RangeError("length");
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  do crypto.getRandomValues(buffer);
  while (buffer[0] >= limit);
  return buffer[0] % length;
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = secureRandomIndex(index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
