CREATE TABLE word_entries (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_word TEXT NOT NULL
    CHECK (length(trim(canonical_word)) > 0),
  display_word TEXT NOT NULL
    CHECK (length(trim(display_word)) > 0),
  comparison_key TEXT NOT NULL UNIQUE
    CHECK (length(trim(comparison_key)) > 0),
  normalization_version TEXT NOT NULL
    CHECK (length(trim(normalization_version)) > 0),
  category TEXT NOT NULL
    CHECK (length(trim(category)) > 0),
  difficulty_score REAL NOT NULL CHECK (difficulty_score >= 0),
  difficulty_version TEXT NOT NULL
    CHECK (length(trim(difficulty_version)) > 0),
  word_length INTEGER NOT NULL CHECK (word_length > 0),
  distinct_letter_count INTEGER NOT NULL
    CHECK (distinct_letter_count BETWEEN 1 AND word_length),
  vowel_count INTEGER NOT NULL CHECK (vowel_count BETWEEN 0 AND word_length),
  consonant_count INTEGER NOT NULL
    CHECK (consonant_count BETWEEN 0 AND word_length),
  letter_frequency_json TEXT NOT NULL
    CHECK (
      json_valid(letter_frequency_json)
      AND json_type(letter_frequency_json) = 'object'
    ),
  repeated_letter_pattern_json TEXT NOT NULL
    CHECK (
      json_valid(repeated_letter_pattern_json)
      AND json_type(repeated_letter_pattern_json) = 'array'
    ),
  rarity_score REAL NOT NULL CHECK (rarity_score >= 0),
  source_name TEXT NOT NULL
    CHECK (length(trim(source_name)) > 0),
  source_url TEXT NOT NULL
    CHECK (length(trim(source_url)) > 0),
  source_version TEXT NOT NULL
    CHECK (length(trim(source_version)) > 0),
  source_entry_id TEXT,
  license_name TEXT NOT NULL
    CHECK (length(trim(license_name)) > 0),
  license_url TEXT,
  attribution_text TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'validated', 'rejected')),
  validated_at TEXT,
  validation_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (vowel_count + consonant_count = word_length),
  CHECK (validation_status != 'validated' OR validated_at IS NOT NULL),
  UNIQUE (source_name, source_version, source_entry_id)
);

CREATE INDEX word_entries_validated_pairing_idx
  ON word_entries (
    category,
    word_length,
    difficulty_version,
    difficulty_score,
    distinct_letter_count,
    vowel_count,
    rarity_score
  )
  WHERE validation_status = 'validated';

CREATE INDEX word_entries_validation_review_idx
  ON word_entries (validation_status, source_name, source_version)
  WHERE validation_status IN ('pending', 'rejected');
