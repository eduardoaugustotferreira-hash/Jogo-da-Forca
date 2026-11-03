export const MAX_LIVES = 6;
export const DEATHMATCH_LIVES = 1;
export const TERMINAL_BATCH_MS = 100;
export const DISCONNECT_GRACE_MS = 60_000;
export const MAX_RECENT_EVENTS = 512;

const CHARACTERS = new Set(["knight", "archer", "mage"]);
const LETTER = /^[a-z]$/;

export function validCharacter(characterId) {
  return CHARACTERS.has(characterId);
}

export function createWaitingRoom({
  code,
  host,
  createdAt,
  expiresAt,
}) {
  return {
    version: 1,
    code,
    matchId: crypto.randomUUID(),
    createdAt,
    expiresAt,
    phase: "waiting",
    players: [
      {
        userId: host.userId,
        displayName: host.displayName,
        characterId: host.characterId,
        seat: 1,
        connected: false,
        score: 0,
        word: null,
        guessedLetters: [],
        revealedIndices: [],
        lives: MAX_LIVES,
        terminal: null,
      },
    ],
    roundNumber: 0,
    roundMode: "normal",
    usedWordIds: [],
    eventResults: {},
    eventOrder: [],
    serverSequence: 0,
    tieBreakSeat: null,
    terminalDeadlineAt: null,
    pausedPhase: null,
    disconnectDeadlineAt: null,
    winnerUserId: null,
    endReason: null,
    matchPersisted: false,
    matchFinalized: false,
  };
}

function playerById(state, userId) {
  return state.players.find((player) => player.userId === userId);
}

export function startRound(state, pair, { mode = "normal", tieBreakSeat } = {}) {
  if (
    state.players.length !== 2 ||
    ![1, 2].includes(tieBreakSeat) ||
    !["normal", "deathmatch"].includes(mode) ||
    !pair?.playerOne?.id ||
    !pair?.playerTwo?.id ||
    pair.playerOne.id === pair.playerTwo.id ||
    state.usedWordIds.includes(pair.playerOne.id) ||
    state.usedWordIds.includes(pair.playerTwo.id)
  ) {
    throw new TypeError("A valid pair of distinct unused words is required.");
  }

  state.roundNumber += 1;
  state.roundMode = mode;
  state.phase = "playing";
  state.tieBreakSeat = tieBreakSeat;
  state.terminalDeadlineAt = null;
  const lives = mode === "deathmatch" ? DEATHMATCH_LIVES : MAX_LIVES;
  const words = [pair.playerOne, pair.playerTwo];
  for (const player of state.players) {
    const word = words[player.seat - 1];
    if (
      !word ||
      typeof word.display_word !== "string" ||
      typeof word.comparison_key !== "string" ||
      word.comparison_key.length === 0
    ) {
      throw new TypeError("Word pair is incomplete.");
    }
    const letters = Array.from(word.comparison_key);
    const hintIndex =
      mode === "deathmatch" ? secureRandomIndex(letters.length) : null;
    player.word = {
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
    player.guessedLetters = [];
    player.guessResults = {};
    player.revealedIndices = hintIndex === null ? [] : [hintIndex];
    player.lives = lives;
    player.terminal = null;
  }
  state.usedWordIds.push(pair.playerOne.id, pair.playerTwo.id);
  return state;
}

export function applyGuess(state, userId, command, now = Date.now()) {
  const player = playerById(state, userId);
  if (!player) {
    return { status: "not_a_member" };
  }
  if (!command || typeof command.eventId !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(command.eventId)) {
    return { status: "invalid_event_id" };
  }
  const key = `${userId}:${command.eventId}`;
  if (Object.hasOwn(state.eventResults, key)) {
    return { ...state.eventResults[key], duplicate: true };
  }
  if (
    state.phase !== "playing" ||
    player.terminal ||
    !command.payload ||
    typeof command.payload.letter !== "string"
  ) {
    return remember(state, key, {
      status: "invalid_phase_or_payload",
      sequence: ++state.serverSequence,
    });
  }

  const letter = normalizeGuess(command.payload.letter);
  if (!letter) {
    return remember(state, key, {
      status: "invalid_letter",
      sequence: ++state.serverSequence,
    });
  }
  const sequence = ++state.serverSequence;
  if (player.guessedLetters.includes(letter)) {
    return remember(state, key, {
      status: "already_guessed",
      letter,
      lives: player.lives,
      sequence,
    });
  }

  player.guessedLetters.push(letter);
  const letters = Array.from(player.word.comparisonKey);
  const positions = letters.flatMap((value, index) =>
    value === letter ? [index] : [],
  );
  if (positions.length) {
    player.guessResults[letter] = "correct";
    player.revealedIndices = [
      ...new Set([...player.revealedIndices, ...positions]),
    ].sort((a, b) => a - b);
    const result = {
      status: "correct",
      letter,
      lives: player.lives,
      revealedIndices: [...player.revealedIndices],
      sequence,
    };
    if (player.revealedIndices.length === letters.length) {
      if (state.roundMode === "deathmatch") {
        result.status = "word_completed";
        result.needsDeathmatchWord = true;
      } else {
        player.terminal = "won";
        state.terminalDeadlineAt ??= now + TERMINAL_BATCH_MS;
        result.terminal = "won";
      }
    }
    return remember(state, key, result);
  }

  player.lives = Math.max(0, player.lives - 1);
  player.guessResults[letter] = "incorrect";
  const result = {
    status: "incorrect",
    letter,
    lives: player.lives,
    sequence,
  };
  if (player.lives === 0) {
    player.terminal = "lost";
    state.terminalDeadlineAt ??= now + TERMINAL_BATCH_MS;
    result.terminal = "lost";
  }
  return remember(state, key, result);
}

export function applyLeave(state, userId, eventId) {
  const player = playerById(state, userId);
  if (!player) return { status: "not_a_member" };
  if (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(eventId)) {
    return { status: "invalid_event_id" };
  }
  const key = `${userId}:${eventId}`;
  if (Object.hasOwn(state.eventResults, key)) {
    return { ...state.eventResults[key], duplicate: true };
  }
  const opponent = state.players.find((item) => item !== player);
  player.connected = false;
  state.terminalDeadlineAt = null;
  state.disconnectDeadlineAt = null;
  if (opponent) {
    state.phase = "completed";
    state.winnerUserId = opponent.userId;
    state.endReason = "voluntary_abandonment";
  } else {
    state.phase = "cancelled";
    state.endReason = "host_left";
  }
  const result = remember(state, key, {
    status: "room_left",
    winnerUserId: state.winnerUserId,
    sequence: ++state.serverSequence,
  });
  return result;
}

export function resolveTerminalBatch(state, now = Date.now()) {
  if (
    !state.terminalDeadlineAt ||
    now < state.terminalDeadlineAt ||
    state.phase !== "playing"
  ) {
    return { status: "not_ready" };
  }
  state.terminalDeadlineAt = null;
  const [first, second] = state.players;
  const terminal = state.players.filter((player) => player.terminal);

  if (state.roundMode === "deathmatch") {
    if (terminal.length === 2) {
      return completeMatch(
        state,
        state.players.find((player) => player.seat === state.tieBreakSeat),
        "deathmatch_tie_break",
      );
    }
    if (terminal.length === 1) {
      const winner = state.players.find((player) => player !== terminal[0]);
      return completeMatch(state, winner, "deathmatch_elimination");
    }
    return { status: "not_ready" };
  }

  if (terminal.length === 2) {
    if (first.terminal === "lost" && second.terminal === "lost") {
      return { status: "draw", nextMode: "normal" };
    }
    const winner =
      first.terminal === "won" && second.terminal === "won"
        ? state.players.find((player) => player.seat === state.tieBreakSeat)
        : first.terminal === "won"
          ? first
          : second;
    return scoreRound(state, winner, "terminal_batch");
  }
  if (terminal.length === 1) {
    const winner =
      terminal[0].terminal === "won"
        ? terminal[0]
        : state.players.find((player) => player !== terminal[0]);
    return scoreRound(state, winner, "single_terminal");
  }
  return { status: "not_ready" };
}

export function setPaused(state, now = Date.now()) {
  if (state.phase === "playing" || state.phase === "waiting") {
    state.pausedPhase = state.phase;
    state.phase = "paused";
    state.disconnectDeadlineAt = now + DISCONNECT_GRACE_MS;
  }
}

export function resolveDisconnectExpiry(state, now = Date.now()) {
  if (
    state.phase !== "paused" ||
    !state.disconnectDeadlineAt ||
    now < state.disconnectDeadlineAt
  ) {
    return { status: "not_ready" };
  }
  const absent = state.players.filter((player) => !player.connected);
  state.disconnectDeadlineAt = null;
  if (absent.length === state.players.length) {
    state.phase = "cancelled";
    state.endReason = "both_players_disconnected";
    return { status: "cancelled" };
  }
  const winner = state.players.find((player) => player.connected);
  return completeMatch(state, winner, "abandonment");
}

export function normalizeGuess(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
  return LETTER.test(normalized) ? normalized : null;
}

function scoreRound(state, winner, reason) {
  winner.score += 1;
  for (const player of state.players) {
    player.terminal = null;
  }
  if (winner.score >= 3) {
    return completeMatch(state, winner, reason);
  }
  const deathmatch =
    state.players[0].score === 2 && state.players[1].score === 2;
  state.phase = "between_rounds";
  return {
    status: "round_completed",
    winnerUserId: winner.userId,
    scores: state.players.map((player) => player.score),
    nextMode: deathmatch ? "deathmatch" : "normal",
    reason,
  };
}

function completeMatch(state, winner, reason) {
  state.phase = "completed";
  state.winnerUserId = winner?.userId ?? null;
  state.endReason = reason;
  return {
    status: "match_completed",
    winnerUserId: state.winnerUserId,
    reason,
  };
}

function remember(state, key, result) {
  state.eventResults[key] = result;
  state.eventOrder.push(key);
  while (state.eventOrder.length > MAX_RECENT_EVENTS) {
    delete state.eventResults[state.eventOrder.shift()];
  }
  return result;
}

function secureRandomIndex(length) {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("length must be positive");
  }
  const values = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % length;
}
