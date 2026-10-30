---
name: word-balancing
description: "Use when sourcing, importing, validating, normalizing, categorizing, measuring, or pairing Portuguese word-game entries and building a fair non-repeating word bank."
---

# Portuguese word-bank validation and balancing

## When to use

Use for dataset sourcing/import, deduplication, Portuguese normalization, word metadata, difficulty calculation, pair selection, match-level non-repetition, or word-bank coverage claims.

## Source and validation

1. Identify a real Portuguese-language source and record its URL/name, version/date, license, attribution requirements, and permitted redistribution/use before importing.
2. Do not fabricate entries, pad a list, or claim 1,000 verified words without a reproducible count of valid unique entries.
3. Import into a staging format, retaining source/provenance and raw form for audit. Reject empty strings, whitespace, punctuation/numbers, mixed-script entries, controls, duplicates, and entries outside the documented game length.
4. Normalize consistently using Unicode NFC for storage/display and a separately documented comparison key (case-folded and accent-insensitive if that is the game's chosen guess rule). Do not remove diacritics from the displayed answer.
5. Validate Portuguese spelling/lexicon against the chosen licensed source; flag inflections, proper nouns, archaic forms, offensive terms, and ambiguous entries for explicit inclusion policy.
6. Require metadata: canonical word, category, length, difficulty version, source/provenance, and computed statistics.

## Statistics and difficulty

For each normalized answer, calculate and version:

- total length and count of distinct letters;
- vowel/consonant counts under a documented Portuguese vowel policy;
- letter-frequency vector/rarity score from the validated corpus;
- repeated-letter pattern and any other feature used by the game.

Use a transparent, versioned score based on these features. Do not label subjective categories as measured difficulty without documenting the rubric and validation method.

## Pairing and non-repetition

1. Filter to eligible, validated, unused words of the configured category/length range.
2. Generate candidate pairs within a documented tolerance for length, distinct-letter count, vowel ratio, and letter-frequency/rarity score.
3. Choose randomly among eligible pairs on the server, using a secure server-side random source; do not reveal the unused answer or selection seed to clients.
4. Track used word IDs for the entire match, across normal-round resets and Deathmatch. Assign different words to the two players.
5. Define behavior when the eligible unused pool is exhausted: stop/reseed a new match or enter an explicit documented fallback requiring user approval. Never silently repeat or invent a word.
6. Measure coverage by unique valid entry count after all filters, not raw source row count.

## Quality checks

- Re-importing the same source is deterministic and creates no duplicates.
- Every entry has valid provenance/license and required metadata.
- Test Unicode variants, uppercase/accent behavior, duplicate normalized keys, invalid characters, and length boundaries.
- Report corpus size, rejected count/reasons, duplicate count, source license, and difficulty/pairing distributions.
- Keep source snapshot/version and validation report with the dataset; do not commit a source that forbids redistribution.
