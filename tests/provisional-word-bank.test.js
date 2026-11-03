import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  applyGuess,
  createWaitingRoom,
  startRound,
} from "../worker/src/game-engine.js";
import {
  prepareWordBank,
  selectWordForReference,
  selectWordPair,
} from "../worker/src/word-bank.js";

const dataset = JSON.parse(
  await readFile(
    new URL("../data/word-bank/development-provisional.json", import.meta.url),
    "utf8",
  ),
);

test("provisional corpus is sourced, unique, and supports five non-repeating pairs", async () => {
  const { records, report } = await prepareWordBank(dataset);

  assert.equal(report.sourceRows, 30);
  assert.equal(report.validUniqueWords, 30);
  assert.equal(report.rejectedRows, 0);
  assert.equal(report.licenseName.includes("CC BY-SA 4.0"), true);
  assert.equal(new Set(records.map((record) => record.comparison_key)).size, 30);
  assert.ok(
    records.every(
      (record) =>
        record.validation_status === "validated" &&
        record.source_entry_id.includes("?oldid=") &&
        record.difficulty_version === report.difficultyVersion,
    ),
  );

  const usedWordIds = [];
  for (let round = 0; round < 5; round += 1) {
    const pair = selectWordPair(records, {
      category: "geral",
      usedWordIds,
      randomIndex: () => 0,
    });

    assert.equal(pair.status, "selected");
    assert.notEqual(pair.playerOne.id, pair.playerTwo.id);
    assert.equal(usedWordIds.includes(pair.playerOne.id), false);
    assert.equal(usedWordIds.includes(pair.playerTwo.id), false);
    usedWordIds.push(pair.playerOne.id, pair.playerTwo.id);
  }
  assert.equal(usedWordIds.length, 10);
});

test("provisional words start a Deathmatch and rotate to distinct equivalent words", async () => {
  const { records } = await prepareWordBank(dataset);
  const firstPair = selectWordPair(records, {
    category: "geral",
    randomIndex: () => 0,
  });
  assert.equal(firstPair.status, "selected");

  const state = createWaitingRoom({
    code: "23456789ABCD",
    host: {
      userId: "user-1",
      displayName: "Player One",
      characterId: "knight",
    },
    createdAt: 0,
    expiresAt: 100_000,
  });
  state.players.push({
    userId: "user-2",
    displayName: "Player Two",
    characterId: "archer",
    seat: 2,
    connected: true,
    score: 2,
    word: null,
    guessedLetters: [],
    revealedIndices: [],
    lives: 1,
    terminal: null,
  });
  startRound(state, firstPair, { mode: "deathmatch", tieBreakSeat: 1 });

  assert.deepEqual(state.players.map((player) => player.lives), [1, 1]);
  assert.deepEqual(
    state.players.map((player) => player.revealedIndices.length),
    [1, 1],
  );

  const firstWord = state.players[0].word;
  let finalGuess;
  for (const [index, letter] of [
    ...new Set(Array.from(firstWord.comparisonKey)),
  ].entries()) {
    finalGuess = applyGuess(
      state,
      "user-1",
      {
        eventId: `corpus-dm-${index}-event`,
        payload: { letter },
      },
      index,
    );
  }
  assert.equal(finalGuess.status, "word_completed");
  assert.equal(finalGuess.needsDeathmatchWord, true);

  const usedWordIds = [...state.usedWordIds];
  const firstReference = records.find((word) => word.id === firstWord.id);
  const secondReference = records.find(
    (word) => word.id === state.players[1].word.id,
  );
  assert.ok(firstReference);
  assert.ok(secondReference);

  const firstRotation = selectWordForReference(records, firstReference, {
    category: "geral",
    usedWordIds,
    randomIndex: () => 0,
  });
  assert.equal(firstRotation.status, "selected");
  usedWordIds.push(firstRotation.word.id);

  const secondRotation = selectWordForReference(
    records,
    secondReference,
    {
      category: "geral",
      usedWordIds,
      randomIndex: () => 0,
    },
  );
  assert.equal(secondRotation.status, "selected");
  assert.notEqual(firstRotation.word.id, secondRotation.word.id);
  assert.equal(
    state.usedWordIds.includes(firstRotation.word.id),
    false,
  );
});
