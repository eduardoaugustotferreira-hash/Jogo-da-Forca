import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  DIFFICULTY_ALGORITHM_VERSION,
  NORMALIZATION_VERSION,
  normalizeWord,
  prepareWordBank,
  selectWordPair,
  selectWordForReference,
} from "../worker/src/word-bank.js";
import { buildWordEntryInsertSql } from "../worker/src/word-bank-import.js";

const reviewedTestManifest = {
  sourceName: "synthetic test fixture",
  sourceUrl: "https://fixture.invalid/dictionary",
  sourceVersion: "test-v1",
  licenseName: "synthetic test fixture license",
  licenseUrl: "https://fixture.invalid/license",
  attributionText: "Ephemeral test-only data; not a dictionary source.",
  redistributionApproved: true,
  contentValidation: {
    status: "verified",
    referenceUrl: "https://fixture.invalid/lexicon",
    reviewedAt: "2026-01-01T00:00:00.000Z",
  },
};
const migrationOne = await readFile(
  new URL("../worker/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);
const migrationTwo = await readFile(
  new URL("../worker/migrations/0002_word_entries.sql", import.meta.url),
  "utf8",
);

function testDataset(words) {
  return {
    manifest: reviewedTestManifest,
    entries: words.map(([word, category = "geral", sourceEntryId]) => ({
      word,
      category,
      lexicalStatus: "verified",
      sourceEntryId: sourceEntryId ?? word,
    })),
  };
}

function pairEntry(id, overrides = {}) {
  return {
    id,
    display_word: `secret-${id}`,
    validation_status: "validated",
    category: "geral",
    normalization_version: NORMALIZATION_VERSION,
    difficulty_version: DIFFICULTY_ALGORITHM_VERSION,
    difficulty_score: 41,
    word_length: 6,
    distinct_letter_count: 5,
    vowel_count: 3,
    rarity_score: 0.4,
    ...overrides,
  };
}

test("Deathmatch word rotation selects a distinct equivalent word only", () => {
  const reference = pairEntry("used-word");
  const equivalent = pairEntry("fresh-word");
  const unrelated = pairEntry("other-version", {
    difficulty_version: "other-rubric-v2",
  });
  const selection = selectWordForReference(
    [reference, equivalent, unrelated],
    reference,
    {
      category: "geral",
      usedWordIds: ["used-word"],
      randomIndex: () => 0,
    },
  );

  assert.equal(selection.status, "selected");
  assert.equal(selection.word.id, "fresh-word");
  assert.equal(
    selectWordForReference([reference], reference, {
      category: "geral",
      usedWordIds: ["used-word"],
    }).status,
    "no_equivalent_word",
  );
});

test("normalization preserves NFC display spelling and compares without accents", () => {
  const normalized = normalizeWord("A\u00c7A\u0303O");

  assert.equal(normalized.valid, true);
  assert.equal(normalized.displayWord, "A\u00c7\u00c3O");
  assert.equal(normalized.canonicalWord, "a\u00e7\u00e3o");
  assert.equal(normalized.comparisonKey, "acao");
  assert.equal(normalized.letters.length, 4);
  assert.equal(NORMALIZATION_VERSION, "pt-br-nfc-fold-no-diacritics-v1");
});

test("normalization rejects empty, punctuation, numbers, mixed scripts and length bounds", () => {
  assert.equal(normalizeWord("").reason, "word_must_contain_latin_letters_only");
  assert.equal(normalizeWord("casa-das").reason, "word_must_contain_latin_letters_only");
  assert.equal(normalizeWord("casa2").reason, "word_must_contain_latin_letters_only");
  assert.equal(normalizeWord("caса").reason, "word_must_contain_latin_letters_only");
  assert.equal(normalizeWord("ab").reason, "word_length_out_of_range");
  assert.equal(normalizeWord("a".repeat(21)).reason, "word_length_out_of_range");
});

test("preparation rejects accent-insensitive and repeated source duplicates", async () => {
  const prepared = await prepareWordBank(
    testDataset([
      ["ação", "verbos", "entry-1"],
      ["ACAO", "verbos", "entry-2"],
      ["casa", "substantivos", "entry-1"],
    ]),
  );

  assert.equal(prepared.records.length, 1);
  assert.equal(prepared.records[0].display_word, "ação");
  assert.equal(prepared.records[0].comparison_key, "acao");
  assert.deepEqual(
    prepared.rejected.map(({ reason }) => reason),
    ["duplicate_comparison_key", "duplicate_source_entry_id"],
  );
  assert.equal(prepared.report.validUniqueWords, 1);
});

test("preparation rejects entries without explicit lexical review", async () => {
  const prepared = await prepareWordBank({
    manifest: reviewedTestManifest,
    entries: [
      {
        word: "casa",
        category: "geral",
        sourceEntryId: "entry-1",
      },
    ],
  });

  assert.equal(prepared.records.length, 0);
  assert.deepEqual(prepared.rejected, [
    { index: 0, reason: "lexical_content_not_verified" },
  ]);
});

test("preparation requires reviewed provenance, license and lexical validation", async () => {
  await assert.rejects(
    prepareWordBank({
      manifest: { ...reviewedTestManifest, redistributionApproved: false },
      entries: [],
    }),
    /redistributionApproved/,
  );
  await assert.rejects(
    prepareWordBank({
      manifest: {
        ...reviewedTestManifest,
        contentValidation: { status: "pending" },
      },
      entries: [],
    }),
    /contentValidation/,
  );
});

test("difficulty scores are reproducible and include versioned corpus frequencies", async () => {
  const dataset = testDataset([
    ["casa", "geral", "1"],
    ["extraordinario", "geral", "2"],
    ["quiz", "geral", "3"],
    ["banana", "geral", "4"],
  ]);
  const forward = await prepareWordBank(dataset);
  const reversed = await prepareWordBank({
    ...dataset,
    entries: [...dataset.entries].reverse(),
  });
  const byKey = new Map(
    forward.records.map((record) => [
      record.comparison_key,
      record.difficulty_score,
    ]),
  );

  assert.equal(
    forward.report.difficultyVersion.startsWith(
      `${DIFFICULTY_ALGORITHM_VERSION}+`,
    ),
    true,
  );
  assert.equal(
    forward.report.difficultyVersion,
    reversed.report.difficultyVersion,
  );
  const reverseScores = new Map(
    reversed.records.map((record) => [
      record.comparison_key,
      record.difficulty_score,
    ]),
  );
  for (const record of forward.records) {
    assert.equal(
      record.difficulty_score,
      reverseScores.get(record.comparison_key),
    );
  }
  assert.ok(byKey.get("extraordinario") > byKey.get("casa"));
  assert.ok(byKey.get("quiz") >= 0 && byKey.get("quiz") <= 100);
  assert.equal(
    JSON.parse(
      forward.records.find((record) => record.comparison_key === "casa")
        .letter_frequency_json,
    ).a.wordCount,
    2,
  );
  assert.deepEqual(
    JSON.parse(
      forward.records.find((record) => record.comparison_key === "banana")
        .repeated_letter_pattern_json,
    ),
    [
      { letter: "a", count: 3 },
      { letter: "n", count: 2 },
    ],
  );
  assert.ok(forward.records.every((record) => record.rarity_score >= 0));
});

test("pair selection excludes used words and returns only equivalent pairs", () => {
  const entries = [
    pairEntry("used"),
    pairEntry("one"),
    pairEntry("two", { difficulty_score: 42, word_length: 7 }),
    pairEntry("wrong-category", { category: "animais" }),
    pairEntry("unvalidated", { validation_status: "pending" }),
  ];

  const result = selectWordPair(entries, {
    category: "geral",
    usedWordIds: ["used"],
    randomIndex: () => 0,
  });

  assert.equal(result.status, "selected");
  assert.deepEqual([result.playerOne.id, result.playerTwo.id], ["one", "two"]);
  assert.notEqual(result.playerOne.id, result.playerTwo.id);
});

test("pair selection does not compare metrics from different corpus versions", () => {
  const result = selectWordPair(
    [
      pairEntry("one", { difficulty_version: "rubric-corpus-a" }),
      pairEntry("two", { difficulty_version: "rubric-corpus-b" }),
    ],
    { category: "geral" },
  );

  assert.deepEqual(result, {
    status: "no_equivalent_pair",
    eligibleCount: 2,
  });
});

test("top score remains in the final difficulty band", () => {
  const result = selectWordPair(
    [
      pairEntry("one", { difficulty_score: 99 }),
      pairEntry("two", { difficulty_score: 100 }),
    ],
    { category: "geral", randomIndex: () => 0 },
  );

  assert.equal(result.status, "selected");
});

test("pair selection returns controlled outcomes for insufficient or unbalanced pools", () => {
  assert.deepEqual(
    selectWordPair([pairEntry("only")], { category: "geral" }),
    { status: "insufficient_pool", eligibleCount: 1 },
  );
  assert.deepEqual(
    selectWordPair(
      [
        pairEntry("one", { difficulty_score: 19 }),
        pairEntry("two", { difficulty_score: 40 }),
      ],
      { category: "geral" },
    ),
    { status: "no_equivalent_pair", eligibleCount: 2 },
  );
});

test("pair selection rejects invalid injected randomness", () => {
  assert.throws(
    () =>
      selectWordPair([pairEntry("one"), pairEntry("two")], {
        category: "geral",
        randomIndex: () => 2,
      }),
    /invalid pair index/,
  );
});

test("SQL import escapes strings and is idempotent for deterministic source IDs", async () => {
  const { records } = await prepareWordBank(
    testDataset([["casa", "geral", "source-1"]]),
  );
  records[0].attribution_text = "Licensee's attribution";
  const sql = buildWordEntryInsertSql(records);

  assert.match(sql, /ON CONFLICT\(id\) DO NOTHING/);
  assert.match(sql, /Licensee''s attribution/);
  assert.throws(() => buildWordEntryInsertSql([]), /at least one/);
});

test("prepared import SQL applies to D1-compatible schema and repeated import is idempotent", async () => {
  const { records } = await prepareWordBank(
    testDataset([["casa", "geral", "source-1"]]),
  );
  const database = new DatabaseSync(":memory:");

  try {
    database.exec(migrationOne);
    database.exec(migrationTwo);
    const sql = buildWordEntryInsertSql(records);
    database.exec(sql);
    database.exec(sql);

    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM word_entries").get()
        .count,
      1,
    );
    assert.equal(
      database
        .prepare("SELECT validation_status FROM word_entries")
        .get().validation_status,
      "validated",
    );
  } finally {
    database.close();
  }
});
