import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const initialMigration = await readFile(
  new URL("../worker/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);
const wordEntriesMigration = await readFile(
  new URL("../worker/migrations/0002_word_entries.sql", import.meta.url),
  "utf8",
);

const insertWordEntry = `
  INSERT INTO word_entries (
    id, canonical_word, display_word, comparison_key, normalization_version,
    category, difficulty_score, difficulty_version, word_length,
    distinct_letter_count, vowel_count, consonant_count,
    letter_frequency_json, repeated_letter_pattern_json, rarity_score,
    source_name, source_url, source_version, source_entry_id,
    license_name, license_url, attribution_text, validation_status, validated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`;

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(initialMigration);
  database.exec(wordEntriesMigration);
  return database;
}

function fixture(overrides = {}) {
  return {
    id: "fixture-id",
    canonical_word: "fixture",
    display_word: "Fixture",
    comparison_key: "fixture-key",
    normalization_version: "test-normalizer-v1",
    category: "test-category",
    difficulty_score: 1.5,
    difficulty_version: "test-rubric-v1",
    word_length: 7,
    distinct_letter_count: 7,
    vowel_count: 3,
    consonant_count: 4,
    letter_frequency_json: '{"f":1,"i":1,"x":1,"t":1,"u":1,"r":1,"e":1}',
    repeated_letter_pattern_json: "[]",
    rarity_score: 0.75,
    source_name: "test-only fixture",
    source_url: "https://fixture.invalid/source",
    source_version: "test-only",
    source_entry_id: "fixture-source-id",
    license_name: "test-only fixture",
    license_url: null,
    attribution_text: "Ephemeral test fixture; not a corpus entry.",
    validation_status: "validated",
    validated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function insertFixture(database, overrides = {}) {
  const entry = fixture(overrides);
  return database
    .prepare(insertWordEntry)
    .run(
      entry.id,
      entry.canonical_word,
      entry.display_word,
      entry.comparison_key,
      entry.normalization_version,
      entry.category,
      entry.difficulty_score,
      entry.difficulty_version,
      entry.word_length,
      entry.distinct_letter_count,
      entry.vowel_count,
      entry.consonant_count,
      entry.letter_frequency_json,
      entry.repeated_letter_pattern_json,
      entry.rarity_score,
      entry.source_name,
      entry.source_url,
      entry.source_version,
      entry.source_entry_id,
      entry.license_name,
      entry.license_url,
      entry.attribution_text,
      entry.validation_status,
      entry.validated_at,
    );
}

test("word entries migration creates an empty, provenance-aware table", () => {
  const database = createDatabase();

  try {
    const columns = database
      .prepare("PRAGMA table_info(word_entries)")
      .all()
      .map(({ name }) => name);

    assert.deepEqual(
      columns,
      [
        "id",
        "canonical_word",
        "display_word",
        "comparison_key",
        "normalization_version",
        "category",
        "difficulty_score",
        "difficulty_version",
        "word_length",
        "distinct_letter_count",
        "vowel_count",
        "consonant_count",
        "letter_frequency_json",
        "repeated_letter_pattern_json",
        "rarity_score",
        "source_name",
        "source_url",
        "source_version",
        "source_entry_id",
        "license_name",
        "license_url",
        "attribution_text",
        "validation_status",
        "validated_at",
        "validation_notes",
        "created_at",
        "updated_at",
      ],
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM word_entries").get()
        .count,
      0,
    );
  } finally {
    database.close();
  }
});

test("word entries migration adds selection and validation indexes", () => {
  const database = createDatabase();

  try {
    const indexes = database
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'word_entries'",
      )
      .all();

    assert.match(
      indexes.find(({ name }) => name === "word_entries_validated_pairing_idx")
        ?.sql,
      /category,.*word_length,.*difficulty_version,.*difficulty_score/s,
    );
    assert.match(
      indexes.find(({ name }) => name === "word_entries_validated_pairing_idx")
        ?.sql,
      /WHERE validation_status = 'validated'/,
    );
    assert.ok(
      indexes.some(({ name }) => name === "word_entries_validation_review_idx"),
    );
  } finally {
    database.close();
  }
});

test("word entries enforce unique comparison keys and valid metadata", () => {
  const database = createDatabase();

  try {
    insertFixture(database);
    assert.throws(
      () =>
        insertFixture(database, {
          id: "fixture-id-2",
          source_entry_id: "fixture-source-id-2",
        }),
      /UNIQUE constraint failed: word_entries\.comparison_key/,
    );
    assert.throws(
      () =>
        insertFixture(database, {
          id: "fixture-id-3",
          comparison_key: "different-key",
          source_entry_id: "fixture-source-id-3",
          distinct_letter_count: 8,
        }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        insertFixture(database, {
          id: "fixture-id-4",
          comparison_key: "invalid-json-key",
          source_entry_id: "fixture-source-id-4",
          letter_frequency_json: "not-json",
        }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        insertFixture(database, {
          id: "fixture-id-5",
          comparison_key: "unvalidated-key",
          source_entry_id: "fixture-source-id-5",
          validation_status: "validated",
          validated_at: null,
        }),
      /CHECK constraint failed/,
    );
  } finally {
    database.close();
  }
});

test("word entries reject duplicate source references", () => {
  const database = createDatabase();

  try {
    insertFixture(database);
    assert.throws(
      () =>
        insertFixture(database, {
          id: "fixture-id-2",
          comparison_key: "different-key",
        }),
      /UNIQUE constraint failed: word_entries\.source_name, word_entries\.source_version, word_entries\.source_entry_id/,
    );
  } finally {
    database.close();
  }
});
