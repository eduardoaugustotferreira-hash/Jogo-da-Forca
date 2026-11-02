const INSERT_COLUMNS = [
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
];

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("SQL numeric values must be finite");
    }
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildWordEntryInsertSql(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError("at least one prepared word entry is required");
  }

  const rows = records.map((record) => {
    const values = INSERT_COLUMNS.map((column) => {
      if (!Object.hasOwn(record, column)) {
        throw new TypeError(`prepared word entry is missing ${column}`);
      }
      return sqlValue(record[column]);
    });
    return `(${values.join(", ")})`;
  });

  return `INSERT INTO word_entries (${INSERT_COLUMNS.join(", ")}) VALUES\n${rows.join(",\n")}\nON CONFLICT(id) DO NOTHING;\n`;
}
