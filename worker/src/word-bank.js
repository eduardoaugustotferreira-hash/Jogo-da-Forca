export const NORMALIZATION_VERSION = "pt-br-nfc-fold-no-diacritics-v1";
export const DIFFICULTY_ALGORITHM_VERSION = "pt-br-weighted-v1";
export const MIN_WORD_LENGTH = 3;
export const MAX_WORD_LENGTH = 20;

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const DIFFICULTY_WEIGHTS = Object.freeze({
  length: 0.2,
  letterRarity: 0.3,
  distinctLetters: 0.15,
  vowelBalance: 0.1,
  repetition: 0.15,
  rareLetters: 0.1,
});

export function normalizeWord(value) {
  if (typeof value !== "string") {
    return { valid: false, reason: "word_must_be_string" };
  }

  const displayWord = value.normalize("NFC");
  if (!/^\p{Script=Latin}+$/u.test(displayWord)) {
    return { valid: false, reason: "word_must_contain_latin_letters_only" };
  }

  const canonicalWord = displayWord.toLocaleLowerCase("pt-BR").normalize("NFC");
  if (!/^[a-záàâãéêíóôõúüç]+$/u.test(canonicalWord)) {
    return { valid: false, reason: "word_has_unsupported_letters" };
  }
  const comparisonKey = canonicalWord
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");

  if (!/^[a-z]+$/.test(comparisonKey)) {
    return { valid: false, reason: "word_has_unsupported_letters" };
  }

  const wordLength = Array.from(canonicalWord).length;
  if (wordLength < MIN_WORD_LENGTH || wordLength > MAX_WORD_LENGTH) {
    return { valid: false, reason: "word_length_out_of_range" };
  }

  return {
    valid: true,
    displayWord,
    canonicalWord,
    comparisonKey,
    letters: Array.from(comparisonKey),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function sha256Hex(value) {
  return sha256(value);
}

function getWordStatistics(letters) {
  const counts = new Map();
  for (const letter of letters) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }

  const distinctLetterCount = counts.size;
  const vowelCount = letters.filter((letter) => VOWELS.has(letter)).length;

  return {
    wordLength: letters.length,
    distinctLetterCount,
    vowelCount,
    consonantCount: letters.length - vowelCount,
    letterCounts: Object.fromEntries([...counts.entries()].sort()),
    repeatedLetterPattern: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([letter, count]) => ({ letter, count })),
  };
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function getDifficultyBand(score) {
  return Math.min(4, Math.floor(score / 20));
}

function calculateDifficulty(word, corpusFrequencies, corpusStats) {
  const stats = getWordStatistics(word.letters);
  const frequencies = word.letters.map(
    (letter) => corpusFrequencies[letter] ?? 0,
  );
  const surprisals = frequencies.map((frequency) =>
    frequency > 0 ? -Math.log(frequency) : corpusStats.maxSurprisal,
  );
  const rarityScore =
    corpusStats.maxSurprisal === corpusStats.minSurprisal
      ? 0
      : surprisals.reduce((sum, value) => sum + value, 0) /
        surprisals.length /
        (corpusStats.maxSurprisal - corpusStats.minSurprisal);
  const rareLetterCount = frequencies.filter(
    (frequency) => frequency <= corpusStats.rareFrequencyCutoff,
  ).length;
  const lengthScore =
    (stats.wordLength - MIN_WORD_LENGTH) /
    (MAX_WORD_LENGTH - MIN_WORD_LENGTH);
  const distinctScore =
    (stats.distinctLetterCount - 1) / Math.max(1, stats.wordLength - 1);
  const vowelRatio = stats.vowelCount / stats.wordLength;
  const vowelBalanceScore = clamp(Math.abs(vowelRatio - 0.42) / 0.42);
  const repeatedRatio =
    (stats.wordLength - stats.distinctLetterCount) /
    Math.max(1, stats.wordLength - 1);
  const repetitionScore = 1 - repeatedRatio;
  const rareLetterShare = rareLetterCount / stats.wordLength;
  const weightedScore =
    DIFFICULTY_WEIGHTS.length * lengthScore +
    DIFFICULTY_WEIGHTS.letterRarity * clamp(rarityScore) +
    DIFFICULTY_WEIGHTS.distinctLetters * clamp(distinctScore) +
    DIFFICULTY_WEIGHTS.vowelBalance * vowelBalanceScore +
    DIFFICULTY_WEIGHTS.repetition * repetitionScore +
    DIFFICULTY_WEIGHTS.rareLetters * rareLetterShare;

  return {
    ...stats,
    rarityScore: clamp(rarityScore),
    difficultyScore: Number((weightedScore * 100).toFixed(6)),
    letterFrequency: Object.fromEntries(
      Object.keys(stats.letterCounts)
        .sort()
        .map((letter) => [
          letter,
          {
            wordCount: stats.letterCounts[letter],
            corpusProbability: corpusFrequencies[letter],
          },
        ]),
    ),
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("dataset manifest must be an object");
  }

  const requiredText = [
    "sourceName",
    "sourceVersion",
    "licenseName",
    "attributionText",
  ];
  for (const field of requiredText) {
    if (
      typeof manifest[field] !== "string" ||
      !manifest[field].trim() ||
      manifest[field].includes("\u0000")
    ) {
      throw new TypeError(`manifest.${field} is required`);
    }
  }

  const manifestUrls = {};
  for (const field of ["sourceUrl", "licenseUrl"]) {
    let url;
    try {
      url = new URL(manifest[field]);
    } catch {
      throw new TypeError(`manifest.${field} must be an HTTPS URL`);
    }
    if (url.protocol !== "https:") {
      throw new TypeError(`manifest.${field} must be an HTTPS URL`);
    }
    if (url.username || url.password) {
      throw new TypeError(`manifest.${field} must not contain credentials`);
    }
    manifestUrls[field] = url.href;
  }

  if (manifest.redistributionApproved !== true) {
    throw new TypeError("manifest.redistributionApproved must be reviewed true");
  }

  const verification = manifest.contentValidation;
  if (
    !verification ||
    verification.status !== "verified" ||
    typeof verification.reviewedAt !== "string" ||
    Number.isNaN(Date.parse(verification.reviewedAt))
  ) {
    throw new TypeError(
      "manifest.contentValidation must record a reviewed, verified source",
    );
  }

  let referenceUrl;
  try {
    referenceUrl = new URL(verification.referenceUrl);
  } catch {
    throw new TypeError(
      "manifest.contentValidation.referenceUrl must be an HTTPS URL",
    );
  }
  if (referenceUrl.protocol !== "https:") {
    throw new TypeError(
      "manifest.contentValidation.referenceUrl must be an HTTPS URL",
    );
  }
  if (referenceUrl.username || referenceUrl.password) {
    throw new TypeError(
      "manifest.contentValidation.referenceUrl must not contain credentials",
    );
  }

  return {
    sourceName: manifest.sourceName.trim(),
    sourceUrl: manifestUrls.sourceUrl,
    sourceVersion: manifest.sourceVersion.trim(),
    licenseName: manifest.licenseName.trim(),
    licenseUrl: manifestUrls.licenseUrl,
    attributionText: manifest.attributionText.trim(),
    contentValidation: {
      referenceUrl: referenceUrl.href,
      reviewedAt: new Date(verification.reviewedAt).toISOString(),
    },
  };
}

export async function prepareWordBank(dataset) {
  const manifest = validateManifest(dataset?.manifest);
  if (!Array.isArray(dataset.entries)) {
    throw new TypeError("dataset.entries must be an array");
  }

  const accepted = [];
  const rejected = [];
  const seenComparisonKeys = new Set();
  const seenSourceIds = new Set();

  for (const [index, entry] of dataset.entries.entries()) {
    let reason;
    const normalized = normalizeWord(entry?.word);

    if (!normalized.valid) {
      reason = normalized.reason;
    } else if (entry.lexicalStatus !== "verified") {
      reason = "lexical_content_not_verified";
    } else if (
      typeof entry.category !== "string" ||
      !entry.category.trim() ||
      entry.category.trim().length > 60 ||
      entry.category.includes("\u0000")
    ) {
      reason = "category_missing_or_too_long";
    } else if (
      typeof entry.sourceEntryId !== "string" ||
      !entry.sourceEntryId.trim() ||
      entry.sourceEntryId.includes("\u0000")
    ) {
      reason = "source_entry_id_required";
    } else if (seenComparisonKeys.has(normalized.comparisonKey)) {
      reason = "duplicate_comparison_key";
    } else if (seenSourceIds.has(entry.sourceEntryId.trim())) {
      reason = "duplicate_source_entry_id";
    }

    if (reason) {
      rejected.push({ index, reason });
      continue;
    }

    seenComparisonKeys.add(normalized.comparisonKey);
    seenSourceIds.add(entry.sourceEntryId.trim());
    accepted.push({
      ...normalized,
      category: entry.category.trim(),
      sourceEntryId: entry.sourceEntryId.trim(),
    });
  }

  const letterTotals = new Map();
  let totalLetters = 0;
  for (const word of accepted) {
    for (const letter of word.letters) {
      letterTotals.set(letter, (letterTotals.get(letter) ?? 0) + 1);
      totalLetters += 1;
    }
  }

  const corpusFrequencies = Object.fromEntries(
    [...letterTotals.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([letter, count]) => [letter, count / totalLetters]),
  );
  const surprisalValues = Object.values(corpusFrequencies).map((frequency) =>
    -Math.log(frequency),
  );
  const corpusStats = {
    minSurprisal: surprisalValues.length
      ? Math.min(...surprisalValues)
      : 0,
    maxSurprisal: surprisalValues.length
      ? Math.max(...surprisalValues)
      : 0,
    rareFrequencyCutoff: corpusFrequencies.a ?? 0,
  };
  const sortedFrequencies = Object.values(corpusFrequencies).sort(
    (left, right) => left - right,
  );
  if (sortedFrequencies.length) {
    corpusStats.rareFrequencyCutoff =
      sortedFrequencies[Math.floor((sortedFrequencies.length - 1) * 0.1)];
  }

  const frequencyFingerprint = await sha256Hex(stableStringify(corpusFrequencies));
  const difficultyVersion = `${DIFFICULTY_ALGORITHM_VERSION}+${frequencyFingerprint.slice(0, 16)}`;
  const validatedAt = manifest.contentValidation.reviewedAt;
  const records = [];

  for (const word of accepted) {
    const metrics = calculateDifficulty(word, corpusFrequencies, corpusStats);
    const id = await sha256Hex(
      `${manifest.sourceName}\u0000${manifest.sourceVersion}\u0000${word.sourceEntryId}`,
    );
    records.push({
      id,
      canonical_word: word.canonicalWord,
      display_word: word.displayWord,
      comparison_key: word.comparisonKey,
      normalization_version: NORMALIZATION_VERSION,
      category: word.category,
      difficulty_score: metrics.difficultyScore,
      difficulty_version: difficultyVersion,
      word_length: metrics.wordLength,
      distinct_letter_count: metrics.distinctLetterCount,
      vowel_count: metrics.vowelCount,
      consonant_count: metrics.consonantCount,
      letter_frequency_json: JSON.stringify(metrics.letterFrequency),
      repeated_letter_pattern_json: JSON.stringify(
        metrics.repeatedLetterPattern,
      ),
      rarity_score: Number(metrics.rarityScore.toFixed(6)),
      source_name: manifest.sourceName,
      source_url: manifest.sourceUrl,
      source_version: manifest.sourceVersion,
      source_entry_id: word.sourceEntryId,
      license_name: manifest.licenseName,
      license_url: manifest.licenseUrl,
      attribution_text: manifest.attributionText,
      validation_status: "validated",
      validated_at: validatedAt,
      validation_notes: JSON.stringify({
        contentValidationReference: manifest.contentValidation.referenceUrl,
      }),
      difficulty_features: {
        length: metrics.wordLength,
        distinctLetters: metrics.distinctLetterCount,
        vowels: metrics.vowelCount,
        consonants: metrics.consonantCount,
        letterRarity: metrics.rarityScore,
        repeatedLetterPattern: metrics.repeatedLetterPattern,
      },
    });
  }

  return {
    records,
    report: {
      sourceName: manifest.sourceName,
      sourceVersion: manifest.sourceVersion,
      licenseName: manifest.licenseName,
      sourceRows: dataset.entries.length,
      validUniqueWords: records.length,
      rejectedRows: rejected.length,
      rejectedByReason: Object.fromEntries(
        [...rejected.reduce((counts, row) => {
          counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
          return counts;
        }, new Map()).entries()].sort(([left], [right]) =>
          left.localeCompare(right, "en"),
        ),
      ),
      difficultyVersion,
      normalizationVersion: NORMALIZATION_VERSION,
    },
    rejected,
  };
}

export function selectWordPair(
  entries,
  {
    category,
    usedWordIds = [],
    randomIndex = secureRandomIndex,
  } = {},
) {
  if (typeof category !== "string" || !category.trim()) {
    throw new TypeError("category is required for word-pair selection");
  }
  if (!Array.isArray(entries)) {
    throw new TypeError("entries must be an array");
  }

  const used = new Set(usedWordIds);
  const eligible = entries.filter(
    (entry) =>
      entry.validation_status === "validated" &&
      entry.category === category &&
      !used.has(entry.id) &&
      typeof entry.normalization_version === "string" &&
      typeof entry.difficulty_version === "string" &&
      Number.isFinite(entry.difficulty_score) &&
      entry.difficulty_score >= 0 &&
      entry.difficulty_score <= 100 &&
      Number.isInteger(entry.word_length) &&
      entry.word_length > 0 &&
      Number.isInteger(entry.distinct_letter_count) &&
      entry.distinct_letter_count > 0 &&
      Number.isInteger(entry.vowel_count) &&
      entry.vowel_count >= 0 &&
      Number.isFinite(entry.rarity_score) &&
      entry.rarity_score >= 0,
  );

  if (eligible.length < 2) {
    return { status: "insufficient_pool", eligibleCount: eligible.length };
  }

  const isEquivalentPair = (left, right) => {
    const leftVowelRatio = left.vowel_count / left.word_length;
    const rightVowelRatio = right.vowel_count / right.word_length;
    return (
      left.id !== right.id &&
      left.normalization_version === right.normalization_version &&
      left.difficulty_version === right.difficulty_version &&
      getDifficultyBand(left.difficulty_score) ===
        getDifficultyBand(right.difficulty_score) &&
      Math.abs(left.word_length - right.word_length) <= 1 &&
      Math.abs(left.distinct_letter_count - right.distinct_letter_count) <= 2 &&
      Math.abs(leftVowelRatio - rightVowelRatio) <= 0.2 &&
      Math.abs(left.rarity_score - right.rarity_score) <= 0.2
    );
  };
  let pairCount = 0;
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      if (isEquivalentPair(eligible[leftIndex], eligible[rightIndex])) {
        pairCount += 1;
      }
    }
  }

  if (pairCount === 0) {
    return {
      status: "no_equivalent_pair",
      eligibleCount: eligible.length,
    };
  }

  const pairIndex = randomIndex(pairCount);
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= pairCount) {
    throw new RangeError("randomIndex returned an invalid pair index");
  }
  let currentPairIndex = 0;
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      if (!isEquivalentPair(eligible[leftIndex], eligible[rightIndex])) {
        continue;
      }
      if (currentPairIndex === pairIndex) {
        return {
          status: "selected",
          playerOne: eligible[leftIndex],
          playerTwo: eligible[rightIndex],
        };
      }
      currentPairIndex += 1;
    }
  }

  throw new Error("equivalent pair index was not found");
}

export function selectWordForReference(
  entries,
  reference,
  {
    category,
    usedWordIds = [],
    randomIndex = secureRandomIndex,
  } = {},
) {
  const used = new Set(usedWordIds);
  const candidates = entries.filter((entry) => {
    if (
      entry.validation_status !== "validated" ||
      entry.category !== category ||
      used.has(entry.id) ||
      entry.normalization_version !== reference.normalization_version ||
      entry.difficulty_version !== reference.difficulty_version ||
      !Number.isFinite(entry.difficulty_score) ||
      !Number.isInteger(entry.word_length) ||
      !Number.isInteger(entry.distinct_letter_count) ||
      !Number.isInteger(entry.vowel_count) ||
      !Number.isFinite(entry.rarity_score)
    ) {
      return false;
    }

    return (
      getDifficultyBand(entry.difficulty_score) ===
        getDifficultyBand(reference.difficulty_score) &&
      Math.abs(entry.word_length - reference.word_length) <= 1 &&
      Math.abs(
        entry.distinct_letter_count - reference.distinct_letter_count,
      ) <= 2 &&
      Math.abs(
        entry.vowel_count / entry.word_length -
          reference.vowel_count / reference.word_length,
      ) <= 0.2 &&
      Math.abs(entry.rarity_score - reference.rarity_score) <= 0.2
    );
  });

  if (candidates.length === 0) {
    return { status: "no_equivalent_word", eligibleCount: 0 };
  }
  const index = randomIndex(candidates.length);
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
    throw new RangeError("randomIndex returned an invalid word index");
  }
  return { status: "selected", word: candidates[index] };
}

function secureRandomIndex(length) {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("length must be a positive integer");
  }
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return bytes[0] % length;
}
